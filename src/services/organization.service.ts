import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isPermission, PermissionSet } from '@/lib/permissions'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { demoOrganizationService } from '@/services/demo'
import type {
  CurrentMembership,
  MemberRole,
  OrganizationMember,
  OrganizationPatch,
  OrganizationService,
  OrganizationSummary,
  ModerationAction,
  ModerationResult,
  PermissionMatrixRow,
  RoleInput,
} from './service-contracts'
import type { OrganizationRow, ProfileRow, RoleRow } from '@/types/database.types'
import { firstOf } from './postgrest'

/**
 * Organization, membership and role reads.
 *
 * Everything here relies on RLS to scope rows — the queries never pass a user
 * id as a filter, because a filter the client controls is not a security
 * boundary. If a row comes back, the database decided the caller may see it.
 */

export type {
  CurrentMembership,
  MemberRole,
  OrganizationMember,
  OrganizationPatch,
  OrganizationSummary,
  PermissionMatrixRow,
} from './service-contracts'

function toOrganizationSummary(row: OrganizationRow): OrganizationSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    logoUrl: row.logo_url,
    timezone: row.timezone,
  }
}

function toMemberRole(row: RoleRow): MemberRole {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    rank: row.rank,
    isSystem: row.is_system,
  }
}

/**
 * Every role held by the given memberships, keyed by membership id.
 *
 * `member_roles` is the source of truth; `organization_members.role_id` is a
 * trigger-maintained view of the most authoritative entry here, kept only so
 * the roster and the invite flow keep working unchanged.
 */
async function fetchRolesByMember(memberIds: string[]): Promise<Map<string, MemberRole[]>> {
  const byMember = new Map<string, MemberRole[]>()
  if (memberIds.length === 0) return byMember

  const { data, error } = await getSupabase()
    .from('member_roles')
    .select(
      `member_id, role:roles!member_roles_role_id_fkey ( id, key, name, description, rank, is_system, created_by, organization_id, created_at, updated_at )`,
    )
    .in('member_id', memberIds)

  if (error) throw toAppError(error)

  for (const row of data ?? []) {
    const role = firstOf(row.role)
    if (!role) continue
    byMember.set(row.member_id, [...(byMember.get(row.member_id) ?? []), toMemberRole(role)])
  }
  // Most authoritative first, so the UI can lead with the defining role.
  for (const roles of byMember.values()) roles.sort((a, b) => a.rank - b.rank)
  return byMember
}

/**
 * Ban and unban both run through the `moderate-user` Edge Function.
 *
 * The organization half is authoritative and already done by the time the
 * function returns; the auth half can fail on its own, and a 207 says so
 * rather than pretending the whole thing failed.
 */
async function moderateThroughFunction(
  membershipId: string,
  action: 'ban' | 'unban',
  reason: string,
): Promise<ModerationResult> {
  const supabase = getSupabase()

  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) {
    throw new AppError('auth', 'Your session has expired. Please sign in again.')
  }

  const response = await supabase.functions.invoke<{
    ok?: boolean
    authUpdated?: boolean
    warning?: string
    error?: string
  }>('moderate-user', { body: { memberId: membershipId, action, reason } })

  const error: unknown = response.error
  if (error) {
    // supabase-js surfaces a non-2xx as an error without the body, so the
    // server's own message is dug out where it is available.
    const context: unknown =
      typeof error === 'object' && error !== null && 'context' in error ? error.context : null
    let message = 'The moderation action could not be completed.'
    if (context instanceof Response) {
      try {
        const body = (await context.json()) as { error?: string }
        if (typeof body.error === 'string') message = body.error
      } catch {
        // Keep the generic message.
      }
    }
    throw new AppError('forbidden', message, { cause: error })
  }

  return {
    authUpdated: response.data?.authUpdated === true,
    warning: response.data?.warning ?? null,
  }
}

export const supabaseOrganizationService: OrganizationService = {
  /** Organizations the signed-in user belongs to. RLS does the filtering. */
  async listMine(): Promise<OrganizationSummary[]> {
    const { data, error } = await getSupabase()
      .from('organizations')
      .select(
        'id, slug, name, tagline, logo_url, timezone, owner_id, created_at, updated_at, deleted_at',
      )
      .is('deleted_at', null)
      .order('name')

    if (error) throw toAppError(error)
    return (data ?? []).map(toOrganizationSummary)
  },

  /**
   * The caller's membership plus their permission set, in one round trip.
   * This is the single source of truth for what the UI offers.
   */
  async getCurrentMembership(organizationId: string): Promise<CurrentMembership | null> {
    const supabase = getSupabase()

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError) throw toAppError(userError)
    const userId = userData.user?.id
    if (!userId) return null

    const [membershipResult, permissionsResult, organizationResult] = await Promise.all([
      supabase
        .from('organization_members')
        .select(
          `id, organization_id, user_id, status, suspended_until, moderation_reason, joined_at,
           role:roles!organization_members_role_id_fkey (
             id, key, name, description, rank, is_system, created_by, organization_id, created_at, updated_at
           )`,
        )
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .maybeSingle(),
      supabase.rpc('my_permissions', { p_organization_id: organizationId }),
      supabase.from('organizations').select('owner_id').eq('id', organizationId).maybeSingle(),
    ])

    if (membershipResult.error) throw toAppError(membershipResult.error)
    if (permissionsResult.error) throw toAppError(permissionsResult.error)
    if (organizationResult.error) throw toAppError(organizationResult.error)
    if (!membershipResult.data) return null

    const role = firstOf(membershipResult.data.role)
    if (!role) {
      throw new AppError('server', 'Your membership is missing a role. Contact an administrator.')
    }

    // `my_permissions` returns setof text; PostgREST delivers it as rows.
    const rawPermissions: unknown = permissionsResult.data
    const permissionKeys = Array.isArray(rawPermissions)
      ? rawPermissions
          .map((entry) =>
            typeof entry === 'string'
              ? entry
              : typeof entry === 'object' && entry !== null && 'my_permissions' in entry
                ? String((entry as { my_permissions: unknown }).my_permissions)
                : '',
          )
          .filter(isPermission)
      : []

    const rolesByMember = await fetchRolesByMember([membershipResult.data.id])

    return {
      membershipId: membershipResult.data.id,
      organizationId: membershipResult.data.organization_id,
      status: membershipResult.data.status,
      joinedAt: membershipResult.data.joined_at,
      role: toMemberRole(role),
      roles: rolesByMember.get(membershipResult.data.id) ?? [toMemberRole(role)],
      // Ownership lives on the organization, never on a role. A role called
      // "Owner" grants nothing; renaming a role transfers nothing.
      isOwner: organizationResult.data?.owner_id === userId,
      suspendedUntil: membershipResult.data.suspended_until,
      moderationReason: membershipResult.data.moderation_reason,
      permissions: new PermissionSet(permissionKeys),
    }
  },

  async listMembers(organizationId: string): Promise<OrganizationMember[]> {
    const { data, error } = await getSupabase()
      .from('organization_members')
      .select(
        `id, organization_id, user_id, status, suspended_until, moderation_reason, joined_at,
         role:roles!organization_members_role_id_fkey (
           id, key, name, description, rank, is_system, created_by, organization_id, created_at, updated_at
         ),
         profile:profiles!organization_members_user_id_fkey (
           id, email, full_name, display_name, avatar_url, title, timezone, last_seen_at
         )`,
      )
      .eq('organization_id', organizationId)
      .order('joined_at')

    if (error) throw toAppError(error)

    const rolesByMember = await fetchRolesByMember((data ?? []).map((row) => row.id))

    return (data ?? []).flatMap((row): OrganizationMember[] => {
      const role = firstOf(row.role)
      const profile = firstOf(row.profile) as Partial<ProfileRow> | null
      // A row missing its joins means RLS hid the related record; skip it
      // rather than rendering a broken member card.
      if (!role || !profile?.id) return []

      return [
        {
          id: row.id,
          userId: row.user_id,
          organizationId: row.organization_id,
          status: row.status,
          joinedAt: row.joined_at,
          role: toMemberRole(role),
          roles: rolesByMember.get(row.id) ?? [toMemberRole(role)],
          suspendedUntil: row.suspended_until,
          moderationReason: row.moderation_reason,
          profile: {
            id: profile.id,
            email: profile.email ?? '',
            fullName: profile.full_name ?? null,
            displayName: profile.display_name ?? null,
            avatarUrl: profile.avatar_url ?? null,
            title: profile.title ?? null,
            timezone: profile.timezone ?? 'UTC',
            lastSeenAt: profile.last_seen_at ?? null,
          },
        },
      ]
    })
  },

  async listRoles(organizationId: string): Promise<MemberRole[]> {
    const { data, error } = await getSupabase()
      .from('roles')
      .select(
        'id, key, name, description, rank, is_system, created_by, organization_id, created_at, updated_at',
      )
      .eq('organization_id', organizationId)
      .order('rank')

    if (error) throw toAppError(error)
    return (data ?? []).map(toMemberRole)
  },

  /**
   * The full capability matrix for an organization: every permission in the
   * catalogue, and which roles currently grant it.
   *
   * This lives in the service rather than the settings screen so it goes
   * through the same seam as everything else — a component reaching for
   * `getSupabase()` directly is exactly what breaks a swappable backend.
   */
  async getPermissionMatrix(organizationId: string): Promise<PermissionMatrixRow[]> {
    const supabase = getSupabase()
    const [catalog, grants] = await Promise.all([
      supabase
        .from('permissions')
        .select('key, category, label, description, sort_order')
        .order('sort_order'),
      supabase
        .from('role_permissions')
        .select('role_id, permission_key, roles!inner(organization_id)')
        .eq('roles.organization_id', organizationId),
    ])

    if (catalog.error) throw toAppError(catalog.error)
    if (grants.error) throw toAppError(grants.error)

    const byPermission = new Map<string, Set<string>>()
    for (const grant of grants.data ?? []) {
      const existing = byPermission.get(grant.permission_key) ?? new Set<string>()
      existing.add(grant.role_id)
      byPermission.set(grant.permission_key, existing)
    }

    return (catalog.data ?? []).map((permission) => ({
      key: permission.key,
      category: permission.category,
      label: permission.label,
      description: permission.description,
      grantedRoleIds: byPermission.get(permission.key) ?? new Set<string>(),
    }))
  },

  /**
   * Replace a member's roles with exactly one.
   *
   * `organization_members.role_id` is derived and no longer client-writable,
   * so the new role is assigned first — a member may never reach zero roles —
   * and only then are the others dropped.
   */
  async updateMemberRole(membershipId: string, roleId: string): Promise<void> {
    const supabase = getSupabase()

    const { error: assignError } = await supabase.rpc('assign_role_to_member', {
      p_member_id: membershipId,
      p_role_id: roleId,
    })
    if (assignError) throw toAppError(assignError)

    const existing = await fetchRolesByMember([membershipId])
    for (const role of existing.get(membershipId) ?? []) {
      if (role.id === roleId) continue
      const { error } = await supabase.rpc('unassign_role_from_member', {
        p_member_id: membershipId,
        p_role_id: role.id,
      })
      if (error) throw toAppError(error)
    }
  },

  async createRole(organizationId: string, input: RoleInput): Promise<string> {
    const { data, error } = await getSupabase().rpc('create_role', {
      p_organization_id: organizationId,
      p_name: input.name,
      p_description: input.description,
      p_rank: input.rank,
    })
    if (error) throw toAppError(error)
    if (typeof data !== 'string') {
      throw new AppError('server', 'The role was not created. Please try again.')
    }
    return data
  },

  async updateRole(roleId: string, name: string, description: string | null): Promise<void> {
    const { error } = await getSupabase().rpc('update_role', {
      p_role_id: roleId,
      p_name: name,
      p_description: description,
    })
    if (error) throw toAppError(error)
  },

  async setRoleRank(roleId: string, rank: number): Promise<void> {
    const { error } = await getSupabase().rpc('set_role_rank', {
      p_role_id: roleId,
      p_rank: rank,
    })
    if (error) throw toAppError(error)
  },

  async deleteRole(roleId: string): Promise<void> {
    const { error } = await getSupabase().rpc('delete_role', { p_role_id: roleId })
    if (error) throw toAppError(error)
  },

  async setRolePermissions(roleId: string, permissionKeys: readonly string[]): Promise<void> {
    const { error } = await getSupabase().rpc('set_role_permissions', {
      p_role_id: roleId,
      p_permission_keys: [...permissionKeys],
    })
    if (error) throw toAppError(error)
  },

  async assignRole(membershipId: string, roleId: string): Promise<void> {
    const { error } = await getSupabase().rpc('assign_role_to_member', {
      p_member_id: membershipId,
      p_role_id: roleId,
    })
    if (error) throw toAppError(error)
  },

  async unassignRole(membershipId: string, roleId: string): Promise<void> {
    const { error } = await getSupabase().rpc('unassign_role_from_member', {
      p_member_id: membershipId,
      p_role_id: roleId,
    })
    if (error) throw toAppError(error)
  },

  async suspendMember(membershipId: string, reason: string, days: number | null): Promise<void> {
    const { error } = await getSupabase().rpc('suspend_member', {
      p_member_id: membershipId,
      p_reason: reason,
      p_days: days,
    })
    if (error) throw toAppError(error)
  },

  async unsuspendMember(membershipId: string, reason?: string): Promise<void> {
    const { error } = await getSupabase().rpc('unsuspend_member', {
      p_member_id: membershipId,
      p_reason: reason ?? null,
    })
    if (error) throw toAppError(error)
  },

  /**
   * Banning goes through the Edge Function, not straight to the RPC.
   *
   * Revoking the Auth session needs the service-role key, which must never
   * reach this client. The function calls `ban_member()` with the caller's own
   * JWT first — so Postgres still decides — and only then uses the privileged
   * key for the auth half.
   */
  async banMember(membershipId: string, reason: string): Promise<ModerationResult> {
    return moderateThroughFunction(membershipId, 'ban', reason)
  },

  async unbanMember(membershipId: string, reason?: string): Promise<ModerationResult> {
    return moderateThroughFunction(membershipId, 'unban', reason ?? '')
  },

  async listModerationHistory(
    organizationId: string,
    userId?: string,
  ): Promise<ModerationAction[]> {
    let query = getSupabase()
      .from('moderation_actions')
      .select(
        `id, action, reason, expires_at, created_at, target_user_id,
         actor:profiles!moderation_actions_actor_id_fkey ( display_name, full_name, email )`,
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (userId) query = query.eq('target_user_id', userId)

    const { data, error } = await query
    if (error) throw toAppError(error)

    return (data ?? []).map((row) => {
      const actor = firstOf(row.actor)
      return {
        id: row.id,
        action: row.action as ModerationAction['action'],
        reason: row.reason,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        actorName: actor?.display_name ?? actor?.full_name ?? actor?.email ?? null,
        targetUserId: row.target_user_id,
      }
    })
  },

  async removeMember(membershipId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('organization_members')
      .delete()
      .eq('id', membershipId)

    if (error) throw toAppError(error)
  },

  async updateOrganization(
    organizationId: string,
    patch: OrganizationPatch,
  ): Promise<OrganizationSummary> {
    const { data, error } = await getSupabase()
      .from('organizations')
      .update(patch)
      .eq('id', organizationId)
      .select(
        'id, slug, name, tagline, logo_url, timezone, owner_id, created_at, updated_at, deleted_at',
      )
      .single()

    if (error) throw toAppError(error)
    return toOrganizationSummary(data)
  },
}

/** Dispatches to the demo store when a demo session is active. */
function impl(): OrganizationService {
  return isDemoSessionActive() ? demoOrganizationService : supabaseOrganizationService
}

export const organizationService: OrganizationService = {
  listMine: () => impl().listMine(),
  getCurrentMembership: (organizationId) => impl().getCurrentMembership(organizationId),
  listMembers: (organizationId) => impl().listMembers(organizationId),
  listRoles: (organizationId) => impl().listRoles(organizationId),
  getPermissionMatrix: (organizationId) => impl().getPermissionMatrix(organizationId),
  updateMemberRole: (membershipId, roleId) => impl().updateMemberRole(membershipId, roleId),
  removeMember: (membershipId) => impl().removeMember(membershipId),
  updateOrganization: (organizationId, patch) => impl().updateOrganization(organizationId, patch),
  createRole: (organizationId, input) => impl().createRole(organizationId, input),
  updateRole: (roleId, name, description) => impl().updateRole(roleId, name, description),
  setRoleRank: (roleId, rank) => impl().setRoleRank(roleId, rank),
  deleteRole: (roleId) => impl().deleteRole(roleId),
  setRolePermissions: (roleId, keys) => impl().setRolePermissions(roleId, keys),
  assignRole: (membershipId, roleId) => impl().assignRole(membershipId, roleId),
  unassignRole: (membershipId, roleId) => impl().unassignRole(membershipId, roleId),
  suspendMember: (membershipId, reason, days) => impl().suspendMember(membershipId, reason, days),
  unsuspendMember: (membershipId, reason) => impl().unsuspendMember(membershipId, reason),
  banMember: (membershipId, reason) => impl().banMember(membershipId, reason),
  unbanMember: (membershipId, reason) => impl().unbanMember(membershipId, reason),
  listModerationHistory: (organizationId, userId) =>
    impl().listModerationHistory(organizationId, userId),
}
