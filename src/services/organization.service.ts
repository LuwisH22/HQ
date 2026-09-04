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
  PermissionMatrixRow,
} from './service-contracts'
import type { OrganizationRow, ProfileRow, RoleRow, MemberStatus } from '@/types/database.types'
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

export const supabaseOrganizationService: OrganizationService = {
  /** Organizations the signed-in user belongs to. RLS does the filtering. */
  async listMine(): Promise<OrganizationSummary[]> {
    const { data, error } = await getSupabase()
      .from('organizations')
      .select('id, slug, name, tagline, logo_url, timezone, created_at, updated_at, deleted_at')
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

    const [membershipResult, permissionsResult] = await Promise.all([
      supabase
        .from('organization_members')
        .select(
          `id, organization_id, user_id, status, joined_at,
           role:roles!organization_members_role_id_fkey (
             id, key, name, description, rank, is_system, organization_id, created_at, updated_at
           )`,
        )
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .maybeSingle(),
      supabase.rpc('my_permissions', { p_organization_id: organizationId }),
    ])

    if (membershipResult.error) throw toAppError(membershipResult.error)
    if (permissionsResult.error) throw toAppError(permissionsResult.error)
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

    return {
      membershipId: membershipResult.data.id,
      organizationId: membershipResult.data.organization_id,
      status: membershipResult.data.status,
      joinedAt: membershipResult.data.joined_at,
      role: toMemberRole(role),
      permissions: new PermissionSet(permissionKeys),
    }
  },

  async listMembers(organizationId: string): Promise<OrganizationMember[]> {
    const { data, error } = await getSupabase()
      .from('organization_members')
      .select(
        `id, organization_id, user_id, status, joined_at,
         role:roles!organization_members_role_id_fkey (
           id, key, name, description, rank, is_system, organization_id, created_at, updated_at
         ),
         profile:profiles!organization_members_user_id_fkey (
           id, email, full_name, display_name, avatar_url, title, timezone, last_seen_at
         )`,
      )
      .eq('organization_id', organizationId)
      .order('joined_at')

    if (error) throw toAppError(error)

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
        'id, key, name, description, rank, is_system, organization_id, created_at, updated_at',
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

  async updateMemberRole(membershipId: string, roleId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('organization_members')
      .update({ role_id: roleId })
      .eq('id', membershipId)

    if (error) throw toAppError(error)
  },

  async updateMemberStatus(membershipId: string, status: MemberStatus): Promise<void> {
    const { error } = await getSupabase()
      .from('organization_members')
      .update({ status })
      .eq('id', membershipId)

    if (error) throw toAppError(error)
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
      .select('id, slug, name, tagline, logo_url, timezone, created_at, updated_at, deleted_at')
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
  updateMemberStatus: (membershipId, status) => impl().updateMemberStatus(membershipId, status),
  removeMember: (membershipId) => impl().removeMember(membershipId),
  updateOrganization: (organizationId, patch) => impl().updateOrganization(organizationId, patch),
}
