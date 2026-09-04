import { AppError } from '@/lib/errors'
import {
  canActOnRank,
  canGrantRank,
  isPermission,
  PERMISSIONS,
  PermissionSet,
  type Permission,
} from '@/lib/permissions'
import { isEffectivelyActive } from '@/lib/moderation'
import { endDemoSession, isDemoSessionActive, startDemoSession } from '@/lib/demo-mode'
import type {
  AuditEntry,
  AuditService,
  AuthIdentity,
  AuthService,
  Channel,
  ChannelService,
  Message,
  MessageService,
  CurrentMembership,
  Invitation,
  InvitationService,
  MemberRole,
  OrganizationMember,
  OrganizationService,
  OrganizationSummary,
  PermissionMatrixRow,
  Profile,
  ProfileService,
} from '../service-contracts'
import {
  db,
  latency,
  newId,
  persist,
  recordAudit,
  resetDemoDatabase,
  DEMO_OWNER_PROFILE_ID,
  type DemoChannel,
  type DemoMember,
  type DemoMessage,
  type DemoRole,
} from './demo-database'
import { PERMISSION_CATALOG } from './permission-catalog'

/**
 * Demo implementations of every service.
 *
 * These deliberately reproduce the *authorization rules* enforced by
 * `tg_guard_member_changes` and the RLS policies — rank checks, the last-owner
 * rule, permission gates — so behaviour learned against demo mode matches the
 * real backend. What they do not reproduce is the security guarantee: this
 * runs entirely in the browser and is a development tool only.
 *
 * Production builds never load this module; `vite.config.ts` aliases it to
 * `index.prod.ts`.
 */

/** The seeded Owner profile the demo entry point signs in as. */
const DEMO_ADMIN_ID = DEMO_OWNER_PROFILE_ID

// --- Shared helpers --------------------------------------------------------

/**
 * Reconcile the session flag with the store.
 *
 * The "a demo session is active" flag and the database are separate
 * localStorage entries, so anything that reseeds the store — a schema-version
 * bump, clearing site data for one key — can leave a live session pointing at
 * no user. Rather than dead-ending with "your session has ended", adopt the
 * seeded owner again.
 */
function ensureDemoUser(): void {
  const database = db()
  if (!database.currentUserId && isDemoSessionActive()) {
    database.currentUserId = DEMO_ADMIN_ID
    persist()
  }
}

function requireCurrentUserId(): string {
  ensureDemoUser()
  const userId = db().currentUserId
  if (!userId) {
    throw new AppError('auth', 'Your demo session has ended. Sign in again.')
  }
  return userId
}

function roleById(roleId: string): DemoRole {
  const role = db().roles.find((r) => r.id === roleId)
  if (!role) throw new AppError('not_found', 'That role no longer exists.')
  return role
}

function toMemberRole(role: DemoRole): MemberRole {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    rank: role.rank,
    isSystem: role.isSystem,
  }
}

function memberOf(userId: string): DemoMember | undefined {
  return db().members.find((m) => m.userId === userId)
}

/**
 * Every role a member holds, most authoritative first.
 *
 * `roleId` is the derived primary role, mirroring the trigger-maintained
 * column in Postgres. `roleIds` is the source of truth.
 */
function rolesOf(member: DemoMember): string[] {
  const ids = member.roleIds ?? [member.roleId]
  return [...ids].sort((a, b) => roleById(a).rank - roleById(b).rank)
}

/** Keeps the derived primary role in step, as tg_sync_primary_role does. */
function syncPrimaryRole(member: DemoMember): void {
  const first = rolesOf(member)[0]
  if (first) member.roleId = first
}

/** True when the member owns the organization. Never derived from a role. */
function isOwnerUser(userId: string): boolean {
  return userId === DEMO_OWNER_PROFILE_ID
}

/** Effective rank: -1 for the owner, else the most authoritative role held. */
function rankOfMember(member: DemoMember): number {
  if (isOwnerUser(member.userId)) return -1
  const ranks = rolesOf(member).map((id) => roleById(id).rank)
  return ranks.length > 0 ? Math.min(...ranks) : 1000
}

/** Mirrors is_effectively_active(): a lapsed suspension restores access. */
function effectivelyActive(member: DemoMember): boolean {
  return isEffectivelyActive(member.status, member.suspendedUntil ?? null)
}

function currentRank(): number | null {
  const membership = memberOf(requireCurrentUserId())
  if (!membership || !effectivelyActive(membership)) return null
  return rankOfMember(membership)
}

function permissionsForMember(member: DemoMember): PermissionSet {
  // Suspended and banned members hold nothing at all, whatever their roles
  // say. This is the demo mirror of every helper gating on effective status.
  if (!effectivelyActive(member)) return PermissionSet.empty()

  // The owner implicitly holds everything, so no permission edit can lock
  // them out of their own organization.
  if (isOwnerUser(member.userId)) return new PermissionSet(PERMISSIONS)

  const held = new Set(rolesOf(member))
  const keys = db()
    .rolePermissions.filter((rp) => held.has(rp.roleId))
    .map((rp) => rp.permissionKey)
    .filter(isPermission)
  return new PermissionSet(keys)
}

function permissionsFor(roleId: string): PermissionSet {
  const keys = db()
    .rolePermissions.filter((rp) => rp.roleId === roleId)
    .map((rp) => rp.permissionKey)
    .filter(isPermission)
  return new PermissionSet(keys)
}

/** Mirrors `has_org_permission`. */
function assertPermission(permission: Parameters<PermissionSet['can']>[0], message: string): void {
  const membership = memberOf(requireCurrentUserId())
  if (!membership || !permissionsForMember(membership).can(permission)) {
    throw new AppError('forbidden', message)
  }
}

/** Mirrors assert_can_manage_role: strictly below the actor's authority. */
function assertCanManageRole(roleId: string): DemoRole {
  assertPermission('roles.manage', 'You do not have permission to manage roles.')
  const role = roleById(roleId)
  const actorRank = currentRank() ?? 1000
  if (role.rank <= actorRank) {
    throw new AppError('forbidden', 'You can only manage roles below your own authority')
  }
  return role
}

/** Mirrors the rank and last-owner guards in `tg_guard_member_changes`. */
function assertCanActOnMember(target: DemoMember, options: { newRoleId?: string } = {}): void {
  const actorId = requireCurrentUserId()
  const actorRank = currentRank()
  const targetRank = rankOfMember(target)
  const isSelf = target.userId === actorId

  if (actorRank === null) {
    throw new AppError('forbidden', 'You are not an active member of this organization.')
  }

  if (!canActOnRank(actorRank, targetRank, { isSelf })) {
    throw new AppError('forbidden', 'Cannot modify a member whose role ranks at or above your own')
  }

  if (options.newRoleId) {
    const newRank = roleById(options.newRoleId).rank
    if (!canGrantRank(actorRank, newRank)) {
      throw new AppError('forbidden', 'Cannot grant a role with more authority than your own')
    }
  }

  // Nothing about ownership is checked here: ownership is a property of the
  // organization, not of a role, so changing the owner's roles costs them
  // nothing. Removal and deactivation are guarded by assertOwnerSurvives.
}

/**
 * Mirrors the owner branch of `tg_guard_member_changes`: the owner cannot be
 * removed or deactivated, by anyone, including themselves. There is exactly
 * one owner, named on the organization, so the only way out is a transfer.
 */
function assertOwnerSurvives(target: DemoMember, action: 'remove' | 'deactivate'): void {
  if (!isOwnerUser(target.userId)) return
  throw new AppError(
    'validation',
    action === 'remove'
      ? 'The organization owner cannot be removed. Transfer ownership first.'
      : 'The organization owner cannot be deactivated. Transfer ownership first.',
  )
}

/** Mirrors `require_reason` in Postgres. */
function requireReason(reason: string): string {
  const trimmed = reason.trim()
  if (trimmed === '') {
    throw new AppError('validation', 'A reason is required for moderation actions')
  }
  if (trimmed.length > 500) {
    throw new AppError('validation', 'Keep the reason under 500 characters')
  }
  return trimmed
}

/**
 * Mirrors `assert_can_moderate`. Ownership is checked against the organization,
 * never against a role, and equal authority is not enough.
 */
function assertCanModerate(membershipId: string, permission: Permission): DemoMember {
  const member = db().members.find((m) => m.id === membershipId)
  if (!member) throw new AppError('not_found', 'That member no longer exists.')

  assertPermission(permission, 'You do not have permission to moderate members.')

  if (member.userId === requireCurrentUserId()) {
    throw new AppError('forbidden', 'You cannot moderate your own membership')
  }
  if (isOwnerUser(member.userId)) {
    throw new AppError(
      'forbidden',
      'The organization owner cannot be moderated. Transfer ownership first.',
    )
  }

  const actorRank = currentRank() ?? 1000
  const targetRank = rankOfMember(member)
  if (actorRank > -1 && targetRank <= actorRank) {
    throw new AppError(
      'forbidden',
      'You cannot moderate a member whose authority is at or above your own',
    )
  }

  return member
}

function clearModerationState(member: DemoMember): void {
  member.status = 'active'
  member.suspendedUntil = null
  member.moderationReason = null
  member.moderatedBy = requireCurrentUserId()
  member.moderatedAt = new Date().toISOString()
}

function recordModeration(
  member: DemoMember,
  action: 'suspend' | 'unsuspend' | 'ban' | 'unban',
  reason: string | null,
  expiresAt: string | null,
): void {
  const store = db()
  store.moderationActions.push({
    id: store.nextModerationId,
    targetMemberId: member.id,
    targetUserId: member.userId,
    actorId: store.currentUserId,
    action,
    reason,
    expiresAt,
    createdAt: new Date().toISOString(),
  })
  store.nextModerationId += 1
}

function displayName(userId: string | null): string {
  if (!userId) return 'System'
  const profile = db().profiles.find((p) => p.id === userId)
  return profile?.displayName ?? profile?.fullName ?? 'Unknown'
}

// --- Auth ------------------------------------------------------------------

type AuthListener = (identity: AuthIdentity | null) => void
const authListeners = new Set<AuthListener>()

function currentIdentity(): AuthIdentity | null {
  ensureDemoUser()
  const database = db()
  if (!database.currentUserId) return null
  const profile = database.profiles.find((p) => p.id === database.currentUserId)
  if (!profile) return null
  return { id: profile.id, email: profile.email }
}

function notifyAuthListeners(): void {
  const identity = currentIdentity()
  for (const listener of authListeners) listener(identity)
}

const notAvailable = (what: string) =>
  new AppError(
    'forbidden',
    `${what} is not available in demo mode. Configure Supabase to use real accounts.`,
  )

export const demoAuthService: AuthService = {
  getSession: () => Promise.resolve(currentIdentity()),

  getUser: () => Promise.resolve(currentIdentity()),

  signInWithPassword: () => Promise.reject(notAvailable('Password sign-in')),

  signInWithMagicLink: () => Promise.reject(notAvailable('Magic-link sign-in')),

  requestPasswordReset: () => Promise.reject(notAvailable('Password reset')),

  updatePassword: () => Promise.reject(notAvailable('Changing your password')),

  acceptInvitation: () => Promise.reject(notAvailable('Accepting an invitation')),

  async signOut() {
    await latency()
    db().currentUserId = null
    persist()
    endDemoSession()
    notifyAuthListeners()
  },

  onAuthStateChange(callback) {
    authListeners.add(callback)
    return () => authListeners.delete(callback)
  },
}

/**
 * The demo entry point. Signs in as the seeded Owner so every implemented
 * screen and permission-gated action is reachable.
 */
export async function signInAsDemoAdmin(): Promise<void> {
  await latency()
  startDemoSession()
  db().currentUserId = DEMO_ADMIN_ID
  persist()
  notifyAuthListeners()
}

/** Restore the seed data. Exposed through the demo banner. */
export function resetDemoData(): void {
  const wasSignedInAs = db().currentUserId
  resetDemoDatabase()
  db().currentUserId = wasSignedInAs
  persist()
}

// --- Organization ----------------------------------------------------------

function toOrganizationSummary(): OrganizationSummary {
  const organization = db().organization
  return {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    tagline: organization.tagline,
    logoUrl: organization.logoUrl,
    timezone: organization.timezone,
  }
}

export const demoOrganizationService: OrganizationService = {
  async listMine() {
    await latency()
    const membership = memberOf(requireCurrentUserId())
    return membership ? [toOrganizationSummary()] : []
  },

  async getCurrentMembership(): Promise<CurrentMembership | null> {
    await latency()
    const userId = db().currentUserId
    if (!userId) return null

    const membership = memberOf(userId)
    if (!membership) return null

    return {
      membershipId: membership.id,
      organizationId: membership.organizationId,
      status: membership.status,
      joinedAt: membership.joinedAt,
      role: toMemberRole(roleById(membership.roleId)),
      roles: rolesOf(membership).map((id) => toMemberRole(roleById(id))),
      isOwner: isOwnerUser(membership.userId),
      suspendedUntil: membership.suspendedUntil ?? null,
      moderationReason: membership.moderationReason ?? null,
      permissions: permissionsForMember(membership),
    }
  },

  async listMembers(): Promise<OrganizationMember[]> {
    await latency()
    assertPermission('members.view', 'You do not have permission to view members.')

    return db().members.flatMap((member) => {
      const profile = db().profiles.find((p) => p.id === member.userId)
      if (!profile) return []
      return [
        {
          id: member.id,
          userId: member.userId,
          organizationId: member.organizationId,
          status: member.status,
          joinedAt: member.joinedAt,
          role: toMemberRole(roleById(member.roleId)),
          roles: rolesOf(member).map((id) => toMemberRole(roleById(id))),
          suspendedUntil: member.suspendedUntil ?? null,
          moderationReason: member.moderationReason ?? null,
          profile: {
            id: profile.id,
            email: profile.email,
            fullName: profile.fullName,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
            title: profile.title,
            timezone: profile.timezone,
            lastSeenAt: profile.lastSeenAt,
          },
        },
      ]
    })
  },

  async listRoles() {
    await latency()
    return [...db().roles].sort((a, b) => a.rank - b.rank).map(toMemberRole)
  },

  async getPermissionMatrix(): Promise<PermissionMatrixRow[]> {
    await latency()
    assertPermission('roles.view', 'You do not have permission to view roles.')

    return PERMISSION_CATALOG.map((entry) => ({
      key: entry.key,
      category: entry.category,
      label: entry.label,
      description: entry.description,
      grantedRoleIds: new Set(
        db()
          .rolePermissions.filter((rp) => rp.permissionKey === entry.key)
          .map((rp) => rp.roleId),
      ),
    }))
  },

  async updateMemberRole(membershipId, roleId) {
    await latency()
    assertPermission('members.manage', 'You do not have permission to manage members.')

    const member = db().members.find((m) => m.id === membershipId)
    if (!member) throw new AppError('not_found', 'That member no longer exists.')

    assertCanActOnMember(member, { newRoleId: roleId })

    const previous = roleById(member.roleId).name
    member.roleIds = [roleId]
    syncPrimaryRole(member)
    recordAudit(
      'member.role_changed',
      'organization_member',
      member.id,
      `${displayName(member.userId)} changed from ${previous} to ${roleById(roleId).name}`,
    )
    persist()
  },

  async createRole(_organizationId, input) {
    await latency()
    assertPermission('roles.manage', 'You do not have permission to manage roles.')

    const actorRank = currentRank() ?? 1000
    if (input.rank <= actorRank) {
      throw new AppError('forbidden', 'You cannot create a role at or above your own authority')
    }

    const id = crypto.randomUUID()
    const organizationId = db().organization.id
    db().roles.push({
      id,
      organizationId,
      key: `custom_${id.slice(0, 8)}`,
      name: input.name,
      description: input.description,
      rank: input.rank,
      isSystem: false,
    })
    recordAudit('role.created', 'role', id, `Role ${input.name} created`)
    persist()
    return id
  },

  async updateRole(roleId, name, description) {
    await latency()
    const role = assertCanManageRole(roleId)
    const previous = role.name
    role.name = name
    role.description = description
    recordAudit('role.updated', 'role', roleId, `Role renamed from ${previous} to ${name}`)
    persist()
  },

  async setRoleRank(roleId, rank) {
    await latency()
    const role = assertCanManageRole(roleId)
    const actorRank = currentRank() ?? 1000
    if (rank <= actorRank) {
      throw new AppError('forbidden', 'You cannot move a role to or above your own authority')
    }
    role.rank = rank
    for (const member of db().members) syncPrimaryRole(member)
    recordAudit('role.updated', 'role', roleId, `Role ${role.name} moved to rank ${String(rank)}`)
    persist()
  },

  async deleteRole(roleId) {
    await latency()
    const role = assertCanManageRole(roleId)

    const stranded = db().members.filter((m) => {
      const held = rolesOf(m)
      return held.includes(roleId) && held.length === 1
    }).length
    if (stranded > 0) {
      throw new AppError(
        'validation',
        `Cannot delete this role: ${String(stranded)} member(s) hold no other role.`,
      )
    }

    for (const member of db().members) {
      member.roleIds = rolesOf(member).filter((id) => id !== roleId)
      syncPrimaryRole(member)
    }
    const store = db()
    store.roles = store.roles.filter((r) => r.id !== roleId)
    store.rolePermissions = store.rolePermissions.filter((rp) => rp.roleId !== roleId)
    recordAudit('role.deleted', 'role', roleId, `Role ${role.name} deleted`)
    persist()
  },

  async setRolePermissions(roleId, permissionKeys) {
    await latency()
    const role = assertCanManageRole(roleId)

    const actor = memberOf(requireCurrentUserId())
    const held = actor ? permissionsForMember(actor) : PermissionSet.empty()
    const existing = new Set(
      db()
        .rolePermissions.filter((rp) => rp.roleId === roleId)
        .map((rp) => rp.permissionKey),
    )

    for (const key of permissionKeys) {
      if (!isPermission(key)) {
        throw new AppError('validation', `Unknown permission ${key}`)
      }
      // Delegation safety: you cannot grant what you do not hold.
      if (!existing.has(key) && !held.can(key)) {
        throw new AppError('forbidden', `You cannot grant a permission you do not hold: ${key}`)
      }
    }

    const store = db()
    store.rolePermissions = store.rolePermissions.filter((rp) => rp.roleId !== roleId)
    for (const key of permissionKeys) {
      if (isPermission(key)) store.rolePermissions.push({ roleId, permissionKey: key })
    }
    recordAudit('role.permissions_changed', 'role', roleId, `Permissions updated for ${role.name}`)
    persist()
  },

  async assignRole(membershipId, roleId) {
    await latency()
    assertPermission('members.manage', 'You do not have permission to manage members.')

    const member = db().members.find((m) => m.id === membershipId)
    if (!member) throw new AppError('not_found', 'That member no longer exists.')

    assertCanActOnMember(member, { newRoleId: roleId })

    const held = rolesOf(member)
    if (!held.includes(roleId)) {
      member.roleIds = [...held, roleId]
      syncPrimaryRole(member)
      recordAudit(
        'member.role_changed',
        'organization_member',
        member.id,
        `Role ${roleById(roleId).name} assigned`,
      )
      persist()
    }
  },

  async unassignRole(membershipId, roleId) {
    await latency()
    assertPermission('members.manage', 'You do not have permission to manage members.')

    const member = db().members.find((m) => m.id === membershipId)
    if (!member) throw new AppError('not_found', 'That member no longer exists.')

    assertCanActOnMember(member)

    const remaining = rolesOf(member).filter((id) => id !== roleId)
    if (remaining.length === 0) {
      throw new AppError('validation', 'A member must keep at least one role')
    }

    member.roleIds = remaining
    syncPrimaryRole(member)
    recordAudit(
      'member.role_changed',
      'organization_member',
      member.id,
      `Role ${roleById(roleId).name} removed`,
    )
    persist()
  },

  async suspendMember(membershipId, reason, days) {
    await latency()
    const member = assertCanModerate(membershipId, 'members.suspend')
    const trimmed = requireReason(reason)

    if (days !== null && (days < 1 || days > 365)) {
      throw new AppError('validation', 'A suspension must last between 1 and 365 days')
    }

    const until =
      days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

    member.status = 'suspended'
    member.suspendedUntil = until
    member.moderationReason = trimmed
    member.moderatedBy = requireCurrentUserId()
    member.moderatedAt = new Date().toISOString()

    recordModeration(member, 'suspend', trimmed, until)
    recordAudit(
      'member.suspended',
      'organization_member',
      member.id,
      until === null
        ? `${displayName(member.userId)} suspended indefinitely`
        : `${displayName(member.userId)} suspended until ${until.slice(0, 10)}`,
    )
    persist()
  },

  async unsuspendMember(membershipId, reason) {
    await latency()
    const member = assertCanModerate(membershipId, 'members.suspend')
    if (member.status !== 'suspended') {
      throw new AppError('validation', 'That member is not suspended')
    }

    clearModerationState(member)
    recordModeration(member, 'unsuspend', reason ?? null, null)
    recordAudit(
      'member.unsuspended',
      'organization_member',
      member.id,
      `${displayName(member.userId)} suspension lifted`,
    )
    persist()
  },

  async banMember(membershipId, reason) {
    await latency()
    const member = assertCanModerate(membershipId, 'members.ban')
    const trimmed = requireReason(reason)

    member.status = 'banned'
    // A ban has no expiry; clearing this stops a stale timestamp being read
    // as one.
    member.suspendedUntil = null
    member.moderationReason = trimmed
    member.moderatedBy = requireCurrentUserId()
    member.moderatedAt = new Date().toISOString()

    recordModeration(member, 'ban', trimmed, null)
    recordAudit(
      'member.banned',
      'organization_member',
      member.id,
      `${displayName(member.userId)} banned`,
    )
    persist()

    // Demo mode has no Supabase Auth to revoke, and saying otherwise would
    // teach behaviour the real backend does not have.
    return { authUpdated: false, warning: 'Demo mode does not revoke authentication sessions.' }
  },

  async unbanMember(membershipId, reason) {
    await latency()
    const member = assertCanModerate(membershipId, 'members.unban')
    if (member.status !== 'banned') {
      throw new AppError('validation', 'That member is not banned')
    }

    // Roles are left exactly as they were: a ban is about access, not about
    // what someone was brought in to do.
    clearModerationState(member)
    recordModeration(member, 'unban', reason ?? null, null)
    recordAudit(
      'member.unbanned',
      'organization_member',
      member.id,
      `${displayName(member.userId)} ban lifted`,
    )
    persist()

    return { authUpdated: false, warning: null }
  },

  async listModerationHistory(_organizationId, userId) {
    await latency()
    return db()
      .moderationActions.filter((entry) => !userId || entry.targetUserId === userId)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((entry) => ({
        id: entry.id,
        action: entry.action,
        reason: entry.reason,
        expiresAt: entry.expiresAt,
        createdAt: entry.createdAt,
        actorName: entry.actorId ? displayName(entry.actorId) : null,
        targetUserId: entry.targetUserId,
      }))
  },

  async removeMember(membershipId) {
    await latency()
    const database = db()
    const member = database.members.find((m) => m.id === membershipId)
    if (!member) throw new AppError('not_found', 'That member no longer exists.')

    const isSelf = member.userId === database.currentUserId
    if (!isSelf) {
      assertPermission('members.remove', 'You do not have permission to remove members.')
    }
    assertCanActOnMember(member)
    assertOwnerSurvives(member, 'remove')

    const name = displayName(member.userId)
    database.members = database.members.filter((m) => m.id !== membershipId)
    recordAudit('member.removed', 'organization_member', membershipId, `${name} was removed`)
    persist()
  },

  async updateOrganization(_organizationId, patch) {
    await latency()
    assertPermission(
      'organization.manage',
      'You do not have permission to change the organization.',
    )

    const organization = db().organization
    if (patch.name !== undefined) organization.name = patch.name
    if (patch.tagline !== undefined) organization.tagline = patch.tagline
    if (patch.timezone !== undefined) organization.timezone = patch.timezone

    recordAudit(
      'organization.updated',
      'organization',
      organization.id,
      'Organization settings updated',
    )
    persist()
    return toOrganizationSummary()
  },
}

// --- Profile ---------------------------------------------------------------

function toProfile(userId: string): Profile {
  const profile = db().profiles.find((p) => p.id === userId)
  if (!profile) throw new AppError('not_found', 'That profile no longer exists.')
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    title: profile.title,
    bio: profile.bio,
    timezone: profile.timezone,
    lastSeenAt: profile.lastSeenAt,
  }
}

export const demoProfileService: ProfileService = {
  async getMine() {
    await latency()
    const userId = db().currentUserId
    return userId ? toProfile(userId) : null
  },

  async update(patch) {
    await latency()
    const userId = requireCurrentUserId()
    const profile = db().profiles.find((p) => p.id === userId)
    if (!profile) throw new AppError('not_found', 'That profile no longer exists.')

    if (patch.displayName !== undefined) profile.displayName = patch.displayName
    if (patch.fullName !== undefined) profile.fullName = patch.fullName
    if (patch.title !== undefined) profile.title = patch.title
    if (patch.bio !== undefined) profile.bio = patch.bio
    if (patch.timezone !== undefined) profile.timezone = patch.timezone

    persist()
    return toProfile(userId)
  },

  touchLastSeen() {
    const userId = db().currentUserId
    if (!userId) return Promise.resolve()
    const profile = db().profiles.find((p) => p.id === userId)
    if (profile) {
      profile.lastSeenAt = new Date().toISOString()
      persist()
    }
    return Promise.resolve()
  },
}

// --- Invitations -----------------------------------------------------------

// --- Channels (Phase 1.5 · B3) ---------------------------------------------

/** The safe subset, mirroring the CHECK constraint on the override table. */
const OVERRIDABLE = ['channels.view', 'messages.send', 'messages.pin', 'messages.moderate']

/**
 * Faithful port of `can_in_channel()`.
 *
 *   1. effectively active member?   no  -> denied   (B2 gate comes first)
 *   2. owner?                       yes -> allowed  (owner_id, not a role)
 *   3. any held role DENIES?        yes -> denied
 *   4. any held role ALLOWS?        yes -> allowed
 *   5. channel is private?          yes -> denied   (allow-list only)
 *   6. otherwise inherit the organization-level answer
 *
 * Deny beats Allow beats Inherit. With several roles held, one DENY is enough.
 */
function canInChannel(channel: DemoChannel, member: DemoMember, permission: Permission): boolean {
  if (!effectivelyActive(member)) return false
  if (isOwnerUser(member.userId)) return true

  const held = new Set(rolesOf(member))
  const overrides = db().channelOverrides.filter(
    (o) => o.channelId === channel.id && o.permissionKey === permission && held.has(o.roleId),
  )

  if (overrides.some((o) => o.effect === 'deny')) return false
  if (overrides.some((o) => o.effect === 'allow')) return true

  // An override is scoped to this channel and nothing else, so a private
  // channel without an explicit ALLOW has nothing to inherit.
  if (channel.isPrivate) return false

  return permissionsForMember(member).can(permission)
}

/** Channels the signed-in demo user may see. */
function visibleChannels(): DemoChannel[] {
  const member = memberOf(requireCurrentUserId())
  if (!member) return []
  return db()
    .channels.filter((c) => canInChannel(c, member, 'channels.view'))
    .sort((a, b) => a.position - b.position)
}

function channelById(channelId: string): DemoChannel {
  const channel = db().channels.find((c) => c.id === channelId)
  if (!channel) throw new AppError('not_found', 'That channel no longer exists.')
  return channel
}

function assertCanManageChannels(): void {
  assertPermission('channels.manage', 'You do not have permission to manage channels.')
}

function toChannel(c: DemoChannel): Channel {
  return {
    id: c.id,
    organizationId: c.organizationId,
    categoryId: c.categoryId,
    key: c.key,
    name: c.name,
    topic: c.topic,
    position: c.position,
    isPrivate: c.isPrivate,
    archivedAt: c.archivedAt,
  }
}

export const demoChannelService: ChannelService = {
  async listCategories() {
    await latency()
    const member = memberOf(requireCurrentUserId())
    if (!member) return []

    const canManage = permissionsForMember(member).can('channels.manage')
    const visible = new Set(visibleChannels().map((c) => c.categoryId))

    // A category is only shown through its contents, so an empty private
    // section does not advertise its own name.
    return db()
      .channelCategories.filter((cat) => canManage || visible.has(cat.id))
      .sort((a, b) => a.position - b.position)
      .map((cat) => ({
        id: cat.id,
        organizationId: cat.organizationId,
        name: cat.name,
        position: cat.position,
      }))
  },

  async listChannels() {
    await latency()
    return visibleChannels().map(toChannel)
  },

  async createCategory(_organizationId, name) {
    await latency()
    assertCanManageChannels()
    const id = crypto.randomUUID()
    const store = db()
    store.channelCategories.push({
      id,
      organizationId: store.organization.id,
      name: name.trim(),
      position: store.channelCategories.length,
    })
    recordAudit('category.created', 'channel_category', id, `Category ${name.trim()} created`)
    persist()
    return id
  },

  async updateCategory(categoryId, name) {
    await latency()
    assertCanManageChannels()
    const category = db().channelCategories.find((c) => c.id === categoryId)
    if (!category) throw new AppError('not_found', 'That category no longer exists.')
    category.name = name.trim()
    recordAudit('category.updated', 'channel_category', categoryId, `Category renamed`)
    persist()
  },

  async deleteCategory(categoryId) {
    await latency()
    assertCanManageChannels()
    const store = db()
    // Channels survive and become uncategorised, mirroring ON DELETE SET NULL.
    for (const channel of store.channels) {
      if (channel.categoryId === categoryId) channel.categoryId = null
    }
    store.channelCategories = store.channelCategories.filter((c) => c.id !== categoryId)
    recordAudit('category.deleted', 'channel_category', categoryId, 'Category deleted')
    persist()
  },

  async reorderCategories(_organizationId, ids) {
    await latency()
    assertCanManageChannels()
    ids.forEach((id, index) => {
      const category = db().channelCategories.find((c) => c.id === id)
      if (category) category.position = index
    })
    persist()
  },

  async createChannel(_organizationId, input) {
    await latency()
    assertPermission('channels.create', 'You do not have permission to create channels.')

    const id = crypto.randomUUID()
    const store = db()
    store.channels.push({
      id,
      organizationId: store.organization.id,
      categoryId: input.categoryId,
      key: `${input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(0, 8)}`,
      name: input.name.trim(),
      topic: input.topic?.trim() || null,
      position: store.channels.length,
      isPrivate: input.isPrivate,
      archivedAt: null,
    })
    recordAudit('channel.created', 'channel', id, `Channel ${input.name.trim()} created`)
    persist()
    return id
  },

  async updateChannel(channelId, patch) {
    await latency()
    assertCanManageChannels()
    const channel = channelById(channelId)

    const member = memberOf(requireCurrentUserId())
    if (!member || !canInChannel(channel, member, 'channels.view')) {
      throw new AppError('forbidden', 'You do not have access to that channel')
    }

    if (patch.name != null && patch.name.trim() !== '') channel.name = patch.name.trim()
    if (patch.topic !== undefined && patch.topic !== null) {
      channel.topic = patch.topic.trim() || null
    }
    if (patch.categoryId !== undefined && patch.categoryId !== null) {
      channel.categoryId = patch.categoryId
    }
    if (patch.isPrivate != null) channel.isPrivate = patch.isPrivate
    if (patch.archived != null) {
      channel.archivedAt = patch.archived ? new Date().toISOString() : null
    }

    recordAudit(
      patch.archived === true
        ? 'channel.archived'
        : patch.archived === false
          ? 'channel.restored'
          : 'channel.updated',
      'channel',
      channelId,
      `Channel ${channel.name} updated`,
    )
    persist()
  },

  async deleteChannel(channelId) {
    await latency()
    assertPermission('channels.delete', 'You do not have permission to delete channels.')
    const channel = channelById(channelId)

    const member = memberOf(requireCurrentUserId())
    if (!member || !canInChannel(channel, member, 'channels.view')) {
      throw new AppError('forbidden', 'You do not have access to that channel')
    }

    const store = db()
    store.channels = store.channels.filter((c) => c.id !== channelId)
    // Overrides go with the channel, mirroring ON DELETE CASCADE.
    store.channelOverrides = store.channelOverrides.filter((o) => o.channelId !== channelId)
    recordAudit('channel.deleted', 'channel', channelId, `Channel ${channel.name} deleted`)
    persist()
  },

  async reorderChannels(_organizationId, ids) {
    await latency()
    assertCanManageChannels()
    ids.forEach((id, index) => {
      const channel = db().channels.find((c) => c.id === id)
      if (channel) channel.position = index
    })
    persist()
  },

  async listOverrides(channelId) {
    await latency()
    assertPermission(
      'channels.permissions_manage',
      'You do not have permission to manage channel permissions.',
    )
    return db()
      .channelOverrides.filter((o) => o.channelId === channelId)
      .map((o) => ({
        channelId: o.channelId,
        roleId: o.roleId,
        permissionKey: o.permissionKey,
        effect: o.effect,
      }))
  },

  async setOverride(channelId, roleId, permissionKey, effect) {
    await latency()
    assertPermission(
      'channels.permissions_manage',
      'You do not have permission to manage channel permissions.',
    )

    const channel = channelById(channelId)
    const role = roleById(roleId)

    if (!OVERRIDABLE.includes(permissionKey)) {
      throw new AppError('validation', `${permissionKey} cannot be overridden per channel`)
    }

    const member = memberOf(requireCurrentUserId())
    if (!member || !canInChannel(channel, member, 'channels.view')) {
      throw new AppError('forbidden', 'You do not have access to that channel')
    }

    // Hierarchy: you may only change access for roles below your own authority.
    const actorRank = currentRank() ?? 1000
    if (actorRank > -1 && role.rank <= actorRank) {
      throw new AppError(
        'forbidden',
        'You can only change access for roles below your own authority',
      )
    }

    // Delegation: you cannot hand out a capability you do not hold.
    if (effect === 'allow' && member && !permissionsForMember(member).can(permissionKey as Permission)) {
      throw new AppError('forbidden', `You cannot grant a permission you do not hold: ${permissionKey}`)
    }

    const store = db()
    store.channelOverrides = store.channelOverrides.filter(
      (o) => !(o.channelId === channelId && o.roleId === roleId && o.permissionKey === permissionKey),
    )
    if (effect !== null) {
      store.channelOverrides.push({ channelId, roleId, permissionKey, effect })
    }

    recordAudit(
      'channel.permission_changed',
      'channel',
      channelId,
      `${permissionKey} on ${channel.name} for ${role.name}: ${effect ?? 'inherit'}`,
    )
    persist()
  },
}

// --- Messages (Phase 2 · C1) -----------------------------------------------

const MESSAGE_PAGE = 50

/** Visibility is inherited from the channel, exactly as the RLS policy does. */
function assertCanReadChannel(channelId: string): DemoChannel {
  const channel = channelById(channelId)
  const member = memberOf(requireCurrentUserId())
  if (!member || !canInChannel(channel, member, 'channels.view')) {
    throw new AppError('forbidden', 'You do not have access to that channel')
  }
  return channel
}

function toMessage(m: DemoMessage): Message {
  const profile = db().profiles.find((p) => p.id === m.authorId)
  return {
    id: m.id,
    channelId: m.channelId,
    authorId: m.authorId,
    // A deleted message keeps its row so replies survive; the body is gone.
    body: m.deletedAt === null ? m.body : '',
    authorName:
      profile?.displayName ?? profile?.fullName ?? profile?.email ?? 'Removed member',
    authorAvatarUrl: profile?.avatarUrl ?? null,
    pinnedAt: m.pinnedAt,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
    createdAt: m.createdAt,
  }
}

export const demoMessageService: MessageService = {
  async list(channelId, before) {
    await latency()
    assertCanReadChannel(channelId)

    const all = db()
      .messages.filter((m) => m.channelId === channelId)
      .filter((m) => (before ? m.createdAt < before : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    const page = all.slice(0, MESSAGE_PAGE)
    return { messages: page.map(toMessage).reverse(), hasMore: all.length > MESSAGE_PAGE }
  },

  async getById(messageId) {
    await latency()
    const message = db().messages.find((m) => m.id === messageId)
    if (!message) return null
    assertCanReadChannel(message.channelId)
    return toMessage(message)
  },

  async send(channelId, body) {
    await latency()
    const channel = channelById(channelId)
    const member = memberOf(requireCurrentUserId())
    if (!member || !canInChannel(channel, member, 'messages.send')) {
      throw new AppError('forbidden', 'You cannot post in that channel')
    }

    const trimmed = body.trim()
    if (trimmed === '') throw new AppError('validation', 'A message cannot be empty')
    if (trimmed.length > 4000) throw new AppError('validation', 'That message is too long')

    const message: DemoMessage = {
      id: crypto.randomUUID(),
      channelId,
      // Taken from the session, never from the caller.
      authorId: member.userId,
      body: trimmed,
      pinnedAt: null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
    }
    db().messages.push(message)
    persist()
    return toMessage(message)
  },

  async edit(messageId, body) {
    await latency()
    const message = db().messages.find((m) => m.id === messageId)
    if (!message) throw new AppError('not_found', 'That message no longer exists.')
    if (message.deletedAt !== null) {
      throw new AppError('validation', 'A deleted message cannot be edited')
    }

    // Editing belongs to the author. messages.moderate confers the power to
    // remove someone's message, never to rewrite their words.
    if (message.authorId !== requireCurrentUserId()) {
      throw new AppError('forbidden', 'You can only edit your own messages')
    }

    const trimmed = body.trim()
    if (trimmed === '') throw new AppError('validation', 'A message cannot be empty')

    message.body = trimmed
    message.editedAt = new Date().toISOString()
    persist()
  },

  async remove(messageId, reason) {
    await latency()
    const message = db().messages.find((m) => m.id === messageId)
    if (!message) throw new AppError('not_found', 'That message no longer exists.')
    if (message.deletedAt !== null) {
      throw new AppError('validation', 'That message has already been deleted')
    }

    const channel = assertCanReadChannel(message.channelId)
    const member = memberOf(requireCurrentUserId())
    const isAuthor = message.authorId === requireCurrentUserId()
    const canModerate = Boolean(member && canInChannel(channel, member, 'messages.moderate'))

    if (!isAuthor && !canModerate) {
      throw new AppError('forbidden', 'You can only delete your own messages')
    }

    message.body = ''
    message.deletedAt = new Date().toISOString()

    // Only moderation is worth a permanent record; auditing every author
    // tidying up their own typo would bury the entries that matter.
    if (!isAuthor) {
      recordAudit(
        'message.deleted',
        'message',
        messageId,
        `Message removed from ${channel.name}${reason ? `: ${reason}` : ''}`,
      )
    }
    persist()
  },

  async setPinned(messageId, pinned) {
    await latency()
    const message = db().messages.find((m) => m.id === messageId)
    if (!message) throw new AppError('not_found', 'That message no longer exists.')
    if (message.deletedAt !== null) {
      throw new AppError('validation', 'A deleted message cannot be pinned')
    }

    const channel = channelById(message.channelId)
    const member = memberOf(requireCurrentUserId())
    if (!member || !canInChannel(channel, member, 'messages.pin')) {
      throw new AppError('forbidden', 'You do not have permission to pin messages here')
    }

    message.pinnedAt = pinned ? new Date().toISOString() : null
    recordAudit(
      pinned ? 'message.pinned' : 'message.unpinned',
      'message',
      messageId,
      `${pinned ? 'Pinned' : 'Unpinned'} a message in ${channel.name}`,
    )
    persist()
  },
}

export const demoInvitationService: InvitationService = {
  async list() {
    await latency()
    assertPermission('members.invite', 'You do not have permission to view invitations.')

    return db()
      .invitations.map((invitation): Invitation => {
        const now = Date.now()
        const expired =
          invitation.status === 'pending' && new Date(invitation.expiresAt).getTime() < now
        return {
          id: invitation.id,
          email: invitation.email,
          status: expired ? 'expired' : invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          roleId: invitation.roleId,
          roleName: roleById(invitation.roleId).name,
          invitedByName: invitation.invitedBy ? displayName(invitation.invitedBy) : null,
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },

  async create(input) {
    await latency()
    assertPermission('members.invite', 'You do not have permission to invite members.')

    const email = input.email.trim().toLowerCase()
    const role = roleById(input.roleId)

    const actorRank = currentRank()
    if (!canGrantRank(actorRank, role.rank)) {
      throw new AppError('forbidden', 'Cannot invite someone at a higher role than your own')
    }

    const database = db()
    if (database.profiles.some((p) => p.email.toLowerCase() === email)) {
      throw new AppError('conflict', 'That person is already a member of this organization')
    }

    // Supersede any live invitation for the same address, as create_invitation does.
    for (const existing of database.invitations) {
      if (existing.email.toLowerCase() === email && existing.status === 'pending') {
        existing.status = 'revoked'
      }
    }

    const invitation = {
      id: newId(),
      organizationId: database.organization.id,
      email,
      roleId: input.roleId,
      invitedBy: database.currentUserId,
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + (input.expiresInDays ?? 7) * 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
    }
    database.invitations.unshift(invitation)

    recordAudit(
      'invitation.created',
      'invitation',
      invitation.id,
      `Invited ${email} as ${role.name}`,
    )
    persist()

    return { id: invitation.id, email }
  },

  async revoke(invitationId) {
    await latency()
    assertPermission('members.invite', 'You do not have permission to revoke invitations.')

    const invitation = db().invitations.find((i) => i.id === invitationId)
    if (!invitation) throw new AppError('not_found', 'That invitation no longer exists.')

    invitation.status = 'revoked'
    recordAudit(
      'invitation.revoked',
      'invitation',
      invitation.id,
      `Invitation to ${invitation.email} revoked`,
    )
    persist()
  },

  async deleteSpent(invitationId) {
    await latency()
    assertPermission('members.invite', 'You do not have permission to manage invitations.')

    const database = db()
    const invitation = database.invitations.find((i) => i.id === invitationId)
    if (invitation && invitation.status === 'pending') {
      throw new AppError('validation', 'Revoke the invitation before deleting it.')
    }
    database.invitations = database.invitations.filter((i) => i.id !== invitationId)
    persist()
  },
}

// --- Audit -----------------------------------------------------------------

export const demoAuditService: AuditService = {
  async listRecent(_organizationId, limit = 20) {
    await latency()

    const membership = memberOf(requireCurrentUserId())
    // Mirrors RLS: without `audit.read` the query simply returns nothing.
    if (!membership || !permissionsFor(membership.roleId).can('audit.read')) return []

    return db()
      .auditLogs.slice(0, Math.min(Math.max(limit, 1), 100))
      .map((entry): AuditEntry => {
        const actor = entry.actorId ? db().profiles.find((p) => p.id === entry.actorId) : undefined
        return {
          id: entry.id,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          summary: entry.summary,
          createdAt: entry.createdAt,
          actor: actor
            ? {
                id: actor.id,
                displayName: actor.displayName,
                fullName: actor.fullName,
                avatarUrl: actor.avatarUrl,
              }
            : null,
        }
      })
  },
}
