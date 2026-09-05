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
  AttachmentService,
  Conversation,
  ConversationService,
  MessageAttachment,
  MentionCandidate,
  Message,
  MessageMention,
  MessageReaction,
  MessageService,
  NotificationService,
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
  type DemoAttachment,
  type DemoChannel,
  type DemoConversation,
  type DemoMember,
  type DemoMessage,
  type DemoRole,
} from './demo-database'
import { rejectAttachment, uploadTypeOf } from '@/features/channels/attachments'
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

/**
 * Write a mention notification for every member named in a message who can
 * actually see the channel it was posted in.
 *
 * The port of `tg_message_mentions`. The check that matters is the last one.
 */
function recordMentions(message: DemoMessage): void {
  const store = db()
  if (message.deletedAt !== null || message.body === '') return

  const channel = message.channelId
    ? store.channels.find((c) => c.id === message.channelId)
    : undefined
  const conversation = message.conversationId
    ? store.conversations.find((c) => c.id === message.conversationId)
    : undefined
  if (!channel && !conversation) return

  const handles = new Set(
    [...message.body.matchAll(/@([A-Za-z0-9._-]{2,40})/g)].map((m) => m[1]?.toLowerCase() ?? ''),
  )

  for (const handle of handles) {
    const profile = store.profiles.find(
      (p) =>
        (p.displayName ?? '').toLowerCase() === handle ||
        p.email.split('@')[0]?.toLowerCase() === handle,
    )
    if (!profile || profile.id === message.authorId) continue

    const member = store.members.find((m) => m.userId === profile.id)
    if (!member) continue

    // Never tell somebody about a message in a place they are not in. In a
    // channel that is the channel resolver; in a conversation it is simply
    // whether they are in it, so naming a colleague in a DM reaches nobody.
    const eligible = channel
      ? canInChannel(channel, member, 'channels.view')
      : canInConversation(conversation!.id, profile.id)
    if (!eligible) continue

    // Two handles can name the same person — a display name and an email
    // local part — so the guard is the resolved id, not the text. Already
    // recorded means already notified: an edit must not notify twice.
    const already = store.mentions.some(
      (m) => m.messageId === message.id && m.userId === profile.id,
    )
    if (already) continue

    store.mentions.push({ messageId: message.id, userId: profile.id, handle })

    store.notifications.push({
      id: store.notifications.length + 1,
      recipientId: profile.id,
      type: 'mention',
      entityType: 'message',
      entityId: message.id,
      actorId: message.authorId,
      summary: `${message.authorId ? displayName(message.authorId) : 'Someone'} mentioned you in ${
        channel ? `#${channel.name}` : 'a direct message'
      }`,
      metadata: channel
        ? {
            channel_id: channel.id,
            channel_key: channel.key,
            channel_name: channel.name,
            excerpt: message.body.slice(0, 160),
          }
        : {
            // No name to carry: a conversation is identified by who is in it,
            // and the recipient is one of them.
            conversation_id: conversation!.id,
            excerpt: message.body.slice(0, 160),
          },
      readAt: null,
      createdAt: message.createdAt,
    })
  }
}

/**
 * What a soft delete takes with it: the port of `tg_message_soft_deleted`.
 *
 * A pin pointing at words nobody can read, and reaction counts on an empty
 * row, are both noise about nothing.
 */
function clearAfterSoftDelete(message: DemoMessage): void {
  const store = db()
  store.reactions = store.reactions.filter((r) => r.messageId !== message.id)
  store.mentions = store.mentions.filter((m) => m.messageId !== message.id)
  // A file listed under a message whose words are gone is the same kind of
  // residue a reaction count on an empty row would be.
  store.attachments = store.attachments.filter((a) => a.messageId !== message.id)
  message.pinnedAt = null
}

/**
 * Whether somebody may take part in a conversation.
 *
 * The port of can_in_conversation_for, and deliberately as short as it is in
 * SQL: membership, plus an effectively active membership of the organization.
 * No owner short-circuit, no role, no override — there is nothing here that a
 * permission edit could change.
 */
function canInConversation(conversationId: string, userId?: string | null): boolean {
  const who = userId ?? db().currentUserId
  if (!who) return false

  const inIt = db().conversationMembers.some(
    (m) => m.conversationId === conversationId && m.userId === who,
  )
  if (!inIt) return false

  const member = memberOf(who)
  return Boolean(member && effectivelyActive(member))
}

/** Conversations the signed-in demo user is in. */
function visibleConversations(): DemoConversation[] {
  return db().conversations.filter((c) => canInConversation(c.id))
}

function assertCanReadConversation(conversationId: string): DemoConversation {
  const conversation = db().conversations.find((c) => c.id === conversationId)
  // Absent and forbidden are the same answer: a guessed id must tell you
  // nothing about whether the conversation exists.
  if (!conversation || !canInConversation(conversationId)) {
    throw new AppError('forbidden', 'You do not have access to that conversation')
  }
  return conversation
}

/** Whether the caller may read the place a message lives in, either kind. */
function canReadMessage(message: DemoMessage): boolean {
  return message.channelId !== null
    ? canReadChannel(message.channelId)
    : canInConversation(message.conversationId!)
}

/** Whether the signed-in demo user may read a channel. */
function canReadChannel(channelId: string): boolean {
  const channel = db().channels.find((c) => c.id === channelId)
  const member = memberOf(db().currentUserId ?? '')
  return Boolean(channel && member && canInChannel(channel, member, 'channels.view'))
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

    // channels_name_length, expressed here too. Without it the demo would
    // accept names the real table rejects, and the difference would only
    // surface in production.
    const trimmed = input.name.trim()
    if (trimmed.length === 0 || trimmed.length > 40) {
      throw new AppError('validation', 'A channel name must be between 1 and 40 characters.')
    }

    const id = crypto.randomUUID()
    const store = db()
    store.channels.push({
      id,
      organizationId: store.organization.id,
      categoryId: input.categoryId,
      key: `${input.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')}-${id.slice(0, 8)}`,
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

  async createChannelInCategory(organizationId, input) {
    // Checked before anything is written, exactly as the routine does, so a
    // refusal here cannot leave a section standing.
    assertPermission('channels.create', 'You do not have permission to create channels.')

    const store = db()
    const wanted = input.categoryName?.trim() ?? ''
    const existing =
      wanted === ''
        ? undefined
        : store.channelCategories.find((c) => c.name.toLowerCase() === wanted.toLowerCase())

    // The server gets this from a single transaction. The nearest honest
    // equivalent here is to put the store back as it was on failure: a
    // category nobody asked for is worse than the failure that created it.
    const snapshot = {
      categories: [...store.channelCategories],
      channels: [...store.channels],
      audit: [...store.auditLogs],
    }

    try {
      const categoryId =
        wanted === ''
          ? null
          : (existing?.id ?? (await demoChannelService.createCategory(organizationId, wanted)))

      return await demoChannelService.createChannel(organizationId, {
        name: input.name,
        topic: null,
        categoryId,
        isPrivate: input.isPrivate,
      })
    } catch (error) {
      store.channelCategories = snapshot.categories
      store.channels = snapshot.channels
      store.auditLogs = snapshot.audit
      persist()
      throw error
    }
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

  async unreadCounts() {
    await latency()
    const me = requireCurrentUserId()
    const store = db()

    // Only channels the caller can see, exactly as the SECURITY INVOKER
    // routine gets from RLS.
    return visibleChannels()
      .filter((c) => c.archivedAt === null)
      .map((channel) => {
        const read = store.channelReads.find((r) => r.channelId === channel.id && r.userId === me)
        const unread = store.messages.filter(
          (m) =>
            m.channelId === channel.id &&
            m.deletedAt === null &&
            m.authorId !== me &&
            (!read || m.createdAt > read.lastReadAt),
        ).length

        return { channelId: channel.id, unread, lastReadAt: read?.lastReadAt ?? null }
      })
  },

  async markRead(channelId) {
    await latency()
    const me = requireCurrentUserId()
    // Recording a read in a channel you cannot see would be a way to learn
    // whether it exists.
    assertCanReadChannel(channelId)

    const store = db()
    const now = new Date().toISOString()
    const existing = store.channelReads.find((r) => r.channelId === channelId && r.userId === me)

    if (existing) {
      // Never backwards: a stale second device must not undo a newer read.
      existing.lastReadAt = existing.lastReadAt > now ? existing.lastReadAt : now
    } else {
      store.channelReads.push({ channelId, userId: me, lastReadAt: now })
    }
    persist()
  },

  async listMentionCandidates(channelId) {
    await latency()
    const channel = db().channels.find((c) => c.id === channelId)
    const me = memberOf(requireCurrentUserId())
    // Empty rather than an error, matching channel_member_ids: a guessed id
    // must look the same as a channel with nobody in it.
    if (!channel || !me || !canInChannel(channel, me, 'channels.view')) return []

    return db()
      .members.filter((m) => canInChannel(channel, m, 'channels.view'))
      .map((member) => {
        const profile = db().profiles.find((p) => p.id === member.userId)
        // The same rule the mention pass resolves by.
        const handle = profile?.displayName ?? (profile?.email ?? '').split('@')[0] ?? ''
        return {
          userId: member.userId,
          handle,
          displayName: profile?.displayName ?? profile?.fullName ?? profile?.email ?? handle,
          avatarUrl: profile?.avatarUrl ?? null,
          roleName: roleById(member.roleId).name,
        }
      })
  },

  async listChannelMembers(channelId) {
    await latency()
    const channel = db().channels.find((c) => c.id === channelId)
    const me = memberOf(requireCurrentUserId())

    // Empty rather than an error for a channel you cannot see: a guessed id
    // must look the same as an empty channel.
    if (!channel || !me || !canInChannel(channel, me, 'channels.view')) return []

    return db()
      .members.filter((m) => canInChannel(channel, m, 'channels.view'))
      .map((m) => m.userId)
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
    if (
      effect === 'allow' &&
      member &&
      !permissionsForMember(member).can(permissionKey as Permission)
    ) {
      throw new AppError(
        'forbidden',
        `You cannot grant a permission you do not hold: ${permissionKey}`,
      )
    }

    const store = db()
    store.channelOverrides = store.channelOverrides.filter(
      (o) =>
        !(o.channelId === channelId && o.roleId === roleId && o.permissionKey === permissionKey),
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

/** The port of the routines' first branch: which place is this message in. */
function assertCanReachMessage(message: DemoMessage): void {
  if (message.channelId !== null) assertCanReadChannel(message.channelId)
  else assertCanReadConversation(message.conversationId!)
}

function toMessage(m: DemoMessage): Message {
  const profile = db().profiles.find((p) => p.id === m.authorId)
  return {
    id: m.id,
    channelId: m.channelId,
    conversationId: m.conversationId,
    authorId: m.authorId,
    // A deleted message keeps its row so replies survive; the body is gone.
    body: m.deletedAt === null ? m.body : '',
    authorName: profile?.displayName ?? profile?.fullName ?? profile?.email ?? 'Removed member',
    authorAvatarUrl: profile?.avatarUrl ?? null,
    pinnedAt: m.pinnedAt,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
    createdAt: m.createdAt,
    parentMessageId: m.parentMessageId,
    replyCount: m.replyCount,
    lastReplyAt: m.lastReplyAt,
  }
}

/**
 * The port of tg_message_thread_guard.
 *
 * One level, a living root, and the same place — both context columns, not
 * just the channel: with channel_id nullable, two direct messages in different
 * conversations would otherwise compare equal on null and a reply could be
 * attached across conversations.
 */
function assertThreadShape(
  parentMessageId: string | null,
  channelId: string | null,
  conversationId: string | null,
): void {
  if (parentMessageId === null) return

  const parent = db().messages.find((m) => m.id === parentMessageId)
  if (!parent) throw new AppError('not_found', 'That message no longer exists')
  if (parent.parentMessageId !== null) {
    throw new AppError('validation', 'A reply cannot itself be replied to')
  }
  if (parent.channelId !== channelId || parent.conversationId !== conversationId) {
    throw new AppError(
      'validation',
      'A reply must be in the same place as the message it replies to',
    )
  }
  if (parent.deletedAt !== null) {
    throw new AppError('validation', 'That message has been deleted')
  }
}

/**
 * Recount a thread from its rows, the way the trigger does.
 *
 * Recomputed rather than incremented so the number cannot drift away from the
 * replies it describes.
 */
function recountThread(rootId: string): void {
  const store = db()
  const root = store.messages.find((m) => m.id === rootId)
  if (!root) return

  const live = store.messages.filter((m) => m.parentMessageId === rootId && m.deletedAt === null)
  root.replyCount = live.length
  root.lastReplyAt =
    live.length === 0 ? null : live.map((m) => m.createdAt).sort((a, b) => b.localeCompare(a))[0]!
}

export const demoMessageService: MessageService = {
  async list(channelId, before) {
    await latency()
    assertCanReadChannel(channelId)

    const all = db()
      .messages.filter((m) => m.channelId === channelId)
      // Roots only: a reply belongs to its thread, not to the timeline.
      .filter((m) => m.parentMessageId === null)
      .filter((m) => (before ? m.createdAt < before : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    const page = all.slice(0, MESSAGE_PAGE)
    return { messages: page.map(toMessage).reverse(), hasMore: all.length > MESSAGE_PAGE }
  },

  async getById(messageId) {
    await latency()
    const message = db().messages.find((m) => m.id === messageId)
    if (!message) return null
    assertCanReachMessage(message)
    return toMessage(message)
  },

  /** The same page, in a conversation. */
  async listConversation(conversationId, before) {
    await latency()
    assertCanReadConversation(conversationId)

    const all = db()
      .messages.filter((m) => m.conversationId === conversationId)
      .filter((m) => m.parentMessageId === null)
      .filter((m) => (before ? m.createdAt < before : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    const page = all.slice(0, MESSAGE_PAGE)
    return { messages: page.map(toMessage).reverse(), hasMore: all.length > MESSAGE_PAGE }
  },

  async sendToConversation(conversationId, body, parentMessageId = null) {
    await latency()
    // Being in it is the whole permission. Suspension and bans are inside
    // canInConversation, so there is no second gate to keep in step.
    assertCanReadConversation(conversationId)
    const me = requireCurrentUserId()

    const trimmed = body.trim()
    if (trimmed === '') throw new AppError('validation', 'A message cannot be empty')
    if (trimmed.length > 4000) {
      throw new AppError('validation', 'A message cannot be longer than 4000 characters')
    }

    assertThreadShape(parentMessageId, null, conversationId)

    const message: DemoMessage = {
      id: crypto.randomUUID(),
      channelId: null,
      conversationId,
      authorId: me,
      body: trimmed,
      pinnedAt: null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      parentMessageId,
      replyCount: 0,
      lastReplyAt: null,
    }
    db().messages.push(message)
    if (parentMessageId !== null) recountThread(parentMessageId)
    recordMentions(message)
    persist()
    return toMessage(message)
  },

  async listConversationPinned(conversationId) {
    await latency()
    assertCanReadConversation(conversationId)

    return db()
      .messages.filter(
        (m) => m.conversationId === conversationId && m.pinnedAt !== null && m.deletedAt === null,
      )
      .sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? ''))
      .map(toMessage)
  },

  async send(channelId, body, parentMessageId = null) {
    await latency()
    const channel = channelById(channelId)
    const member = memberOf(requireCurrentUserId())
    // A reply needs exactly what a message needs. No new permission.
    if (!member || !canInChannel(channel, member, 'messages.send')) {
      throw new AppError('forbidden', 'You cannot post in that channel')
    }

    const trimmed = body.trim()
    if (trimmed === '') throw new AppError('validation', 'A message cannot be empty')
    if (trimmed.length > 4000) throw new AppError('validation', 'That message is too long')

    assertThreadShape(parentMessageId, channelId, null)

    const message: DemoMessage = {
      id: crypto.randomUUID(),
      channelId,
      conversationId: null,
      // Taken from the session, never from the caller.
      authorId: member.userId,
      body: trimmed,
      pinnedAt: null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      parentMessageId,
      replyCount: 0,
      lastReplyAt: null,
    }
    db().messages.push(message)
    if (parentMessageId !== null) recountThread(parentMessageId)
    recordMentions(message)
    persist()
    return toMessage(message)
  },

  async listReplies(rootMessageId) {
    await latency()
    const root = db().messages.find((m) => m.id === rootMessageId)
    if (!root) return []
    // A reply is visible exactly where its root is.
    assertCanReachMessage(root)

    return db()
      .messages.filter((m) => m.parentMessageId === rootMessageId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(toMessage)
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
    // An edit re-derives mentions, as the trigger does. Somebody already
    // recorded is not notified a second time.
    recordMentions(message)
    persist()
  },

  async remove(messageId, reason) {
    await latency()
    const message = db().messages.find((m) => m.id === messageId)
    if (!message) throw new AppError('not_found', 'That message no longer exists.')
    if (message.deletedAt !== null) {
      throw new AppError('validation', 'That message has already been deleted')
    }

    const isAuthor = message.authorId === requireCurrentUserId()
    const member = memberOf(requireCurrentUserId())

    let channel: DemoChannel | null = null
    let canModerate = false

    if (message.channelId !== null) {
      channel = assertCanReadChannel(message.channelId)
      canModerate = Boolean(member && canInChannel(channel, member, 'messages.moderate'))
    } else {
      // No moderation inside a conversation: messages.moderate is a channel
      // permission and holding it must not confer the power to edit the record
      // of other people's private correspondence.
      assertCanReadConversation(message.conversationId!)
    }

    if (!isAuthor && !canModerate) {
      throw new AppError('forbidden', 'You can only delete your own messages')
    }

    // Existence, not the counter: reply_count only counts replies that are
    // themselves alive, and a root whose replies were all deleted still has
    // rows that need it to stay.
    const hasReplies = db().messages.some((m) => m.parentMessageId === message.id)

    if (message.conversationId !== null && !hasReplies) {
      // A tombstone in a private conversation is not a record of anything: it
      // is not evidence of a moderation decision, because there is none, and
      // there are no replies to keep reachable.
      db().messages = db().messages.filter((m) => m.id !== message.id)
      clearAfterSoftDelete(message)

      // And if it was the last reply under a placeholder, the placeholder is
      // the opening of a thread that no longer exists.
      const root = message.parentMessageId
        ? db().messages.find((m) => m.id === message.parentMessageId)
        : undefined
      if (
        root &&
        root.conversationId !== null &&
        root.deletedAt !== null &&
        !db().messages.some((m) => m.parentMessageId === root.id)
      ) {
        db().messages = db().messages.filter((m) => m.id !== root.id)
      }
    } else {
      message.body = ''
      message.deletedAt = new Date().toISOString()
      clearAfterSoftDelete(message)
    }

    if (message.parentMessageId !== null) recountThread(message.parentMessageId)

    // Only moderation is worth a permanent record, and moderation only happens
    // in a channel — so a direct message never writes one.
    if (!isAuthor && channel) {
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

    let channel: DemoChannel | null = null

    if (message.channelId !== null) {
      channel = channelById(message.channelId)
      const member = memberOf(requireCurrentUserId())
      if (!member || !canInChannel(channel, member, 'messages.pin')) {
        throw new AppError('forbidden', 'You do not have permission to pin messages here')
      }
    } else {
      // Pinning is not a permission in a conversation: the people in it are
      // the only people there, and either may keep something at the top.
      assertCanReadConversation(message.conversationId!)
    }

    message.pinnedAt = pinned ? new Date().toISOString() : null

    // A conversation writes no audit row, for the same reason a deletion in
    // one does not: the entry would announce that it exists.
    if (channel) {
      recordAudit(
        pinned ? 'message.pinned' : 'message.unpinned',
        'message',
        messageId,
        `${pinned ? 'Pinned' : 'Unpinned'} a message in ${channel.name}`,
      )
    }
    persist()
  },

  async listPinned(channelId) {
    await latency()
    assertCanReadChannel(channelId)

    return db()
      .messages.filter(
        (m) => m.channelId === channelId && m.pinnedAt !== null && m.deletedAt === null,
      )
      .sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? ''))
      .map(toMessage)
  },

  async listReactions(messageIds) {
    await latency()
    const me = db().currentUserId
    const byMessage = new Map<string, MessageReaction[]>()
    const wanted = new Set(messageIds)

    for (const reaction of db().reactions) {
      if (!wanted.has(reaction.messageId)) continue

      // A reaction is only visible where its message is.
      const message = db().messages.find((m) => m.id === reaction.messageId)
      if (!message || !canReadMessage(message)) continue

      const list = byMessage.get(reaction.messageId) ?? []
      const existing = list.find((r) => r.emoji === reaction.emoji)
      if (existing) {
        existing.count += 1
        existing.mine = existing.mine || reaction.userId === me
      } else {
        list.push({ emoji: reaction.emoji, count: 1, mine: reaction.userId === me })
      }
      byMessage.set(reaction.messageId, list)
    }

    return byMessage
  },

  async listMentions(messageIds) {
    await latency()
    const byMessage = new Map<string, MessageMention[]>()
    const wanted = new Set(messageIds)

    for (const mention of db().mentions) {
      if (!wanted.has(mention.messageId)) continue

      // A mention is only visible where its message is.
      const message = db().messages.find((m) => m.id === mention.messageId)
      if (!message || !canReadMessage(message)) continue

      const list = byMessage.get(mention.messageId) ?? []
      list.push({ userId: mention.userId, handle: mention.handle })
      byMessage.set(mention.messageId, list)
    }

    return byMessage
  },

  async addReaction(messageId, emoji) {
    await latency()
    const me = requireCurrentUserId()
    const store = db()

    const message = store.messages.find((m) => m.id === messageId)
    if (!message) throw new AppError('not_found', 'That message no longer exists.')
    if (message.deletedAt !== null) {
      throw new AppError('validation', 'A deleted message cannot be reacted to.')
    }

    if (message.channelId !== null) {
      // Reacting is speaking in the channel: a deny on messages.send silences
      // this too, or the deny is circumventable as a signalling channel.
      const channel = channelById(message.channelId)
      const member = memberOf(me)
      if (!member || !canInChannel(channel, member, 'messages.send')) {
        throw new AppError('forbidden', 'You cannot react in that channel')
      }
    } else {
      assertCanReadConversation(message.conversationId!)
    }

    const already = store.reactions.some(
      (r) => r.messageId === messageId && r.userId === me && r.emoji === emoji,
    )
    // The composite key makes this a row that cannot exist twice, not an
    // error to report.
    if (already) return

    store.reactions.push({
      messageId,
      userId: me,
      emoji,
      // Whichever the message has, stamped here rather than accepted from a
      // caller — the port of tg_reaction_channel.
      channelId: message.channelId,
      conversationId: message.conversationId,
    })
    persist()
  },

  async removeReaction(messageId, emoji) {
    await latency()
    const me = requireCurrentUserId()
    const store = db()

    store.reactions = store.reactions.filter(
      (r) => !(r.messageId === messageId && r.userId === me && r.emoji === emoji),
    )
    persist()
  },

  async search(input) {
    await latency()
    const needle = input.query.trim().toLowerCase()
    if (needle === '') return []

    const visible = new Set(visibleChannels().map((c) => c.id))
    const mine = new Set(visibleConversations().map((c) => c.id))

    return db()
      .messages.filter((m) => {
        if (m.deletedAt !== null || !m.body.toLowerCase().includes(needle)) return false

        // Naming a conversation searches that conversation, and only if the
        // caller is in it. Naming neither it nor a channel searches channels
        // only — the same scope the search box had before conversations
        // existed.
        if (input.conversationId) {
          return m.conversationId === input.conversationId && mine.has(input.conversationId)
        }
        if (m.conversationId !== null) return false
        if (!m.channelId || !visible.has(m.channelId)) return false
        return input.channelId === null || m.channelId === input.channelId
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30)
      .map((m) => {
        const channel = db().channels.find((c) => c.id === m.channelId)
        return {
          id: m.id,
          channelId: m.channelId,
          conversationId: m.conversationId,
          // A direct message has no channel to name; it is named by who is
          // in it, and the caller is one of them.
          channelName: m.conversationId ? '' : (channel?.name ?? 'Unknown channel'),
          channelKey: channel?.key ?? '',
          authorName: m.authorId ? displayName(m.authorId) : 'Removed member',
          body: m.body,
          createdAt: m.createdAt,
          parentMessageId: m.parentMessageId,
        }
      })
  },
}

/**
 * Notifications, and the mention trigger that writes them.
 *
 * The gate is the same channel resolver everything else uses: a notification
 * is written only for somebody who could have read the message anyway, which
 * is what stops a mention leaking a private channel's name.
 */
/**
 * Direct conversations.
 *
 * The port of the conversations schema and start_direct_message. The whole
 * authorization model is canInConversation, which asks two questions and no
 * others: are you in it, and is your membership of the organization still
 * effective. There is no owner short-circuit here to mirror, because there is
 * none in the SQL either.
 */
export const demoConversationService: ConversationService = {
  async list() {
    await latency()
    const me = db().currentUserId
    const store = db()

    return (
      visibleConversations()
        .map((conversation) => toConversation(conversation, me))
        .sort(byRecency)
        // Referenced so the store read above is not mistaken for a stray.
        .slice(0, store.conversations.length)
    )
  },

  async getById(conversationId) {
    await latency()
    // Absent rather than forbidden: a guessed id must tell you nothing about
    // whether the conversation exists.
    if (!canInConversation(conversationId)) return null
    const conversation = db().conversations.find((c) => c.id === conversationId)
    return conversation ? toConversation(conversation, db().currentUserId) : null
  },

  async startDirect(_organizationId, userId) {
    await latency()
    const me = requireCurrentUserId()
    const store = db()

    // A conversation with yourself is not a conversation.
    if (userId === me) {
      throw new AppError('validation', 'You cannot start a direct message with yourself')
    }

    const mine = memberOf(me)
    if (!mine || !effectivelyActive(mine)) {
      throw new AppError('forbidden', 'You do not have access to that organization')
    }

    const theirs = store.members.find((m) => m.userId === userId)
    // Not found and not active are the same answer on purpose: neither tells
    // the caller anything about somebody they cannot message.
    if (!theirs || !effectivelyActive(theirs)) {
      throw new AppError('not_found', 'That member is not available')
    }

    const memberKey = [me, userId].sort().join(':')
    const existing = store.conversations.find(
      (c) => c.kind === 'direct' && c.memberKey === memberKey,
    )
    // The port of the unique index: the pair has one conversation, and asking
    // for it twice is not an error to report.
    if (existing) return existing.id

    const conversation: DemoConversation = {
      id: crypto.randomUUID(),
      organizationId: store.organization.id,
      kind: 'direct',
      memberKey,
      createdBy: me,
      createdAt: new Date().toISOString(),
    }
    store.conversations.push(conversation)
    store.conversationMembers.push(
      { conversationId: conversation.id, userId: me, joinedAt: conversation.createdAt },
      { conversationId: conversation.id, userId, joinedAt: conversation.createdAt },
    )
    persist()
    return conversation.id
  },

  async markRead(conversationId) {
    await latency()
    const me = requireCurrentUserId()
    // Recording a read in a conversation you are not in would be a way to
    // learn whether it exists.
    assertCanReadConversation(conversationId)

    const store = db()
    const now = new Date().toISOString()
    const existing = store.conversationReads.find(
      (r) => r.conversationId === conversationId && r.userId === me,
    )

    if (existing) {
      // Never backwards: a stale second device must not undo a newer read.
      existing.lastReadAt = existing.lastReadAt > now ? existing.lastReadAt : now
    } else {
      store.conversationReads.push({ conversationId, userId: me, lastReadAt: now })
    }
    persist()
  },

  async listMentionCandidates(conversationId) {
    await latency()
    // Empty rather than an error, matching the live read: a guessed id must
    // look the same as a conversation with nobody in it.
    if (!canInConversation(conversationId)) return []

    return db()
      .conversationMembers.filter((m) => m.conversationId === conversationId)
      .map((m): MentionCandidate | null => {
        const profile = db().profiles.find((p) => p.id === m.userId)
        const member = db().members.find((om) => om.userId === m.userId)
        if (!profile) return null

        // The same rule the mention pass resolves by.
        const handle = profile.displayName ?? profile.email.split('@')[0] ?? ''
        return {
          userId: m.userId,
          handle,
          displayName: profile.displayName ?? profile.fullName ?? profile.email,
          avatarUrl: profile.avatarUrl,
          roleName: member ? roleById(member.roleId).name : 'Member',
        }
      })
      .filter((c): c is MentionCandidate => c !== null)
  },
}

/** The sidebar's shape for one conversation, assembled from the rows. */
function toConversation(conversation: DemoConversation, me: string | null): Conversation {
  const store = db()
  const memberIds = store.conversationMembers
    .filter((m) => m.conversationId === conversation.id)
    .map((m) => m.userId)

  const otherUserId = memberIds.find((id) => id !== me) ?? null
  const profile = otherUserId ? store.profiles.find((p) => p.id === otherUserId) : undefined

  const read = store.conversationReads.find(
    (r) => r.conversationId === conversation.id && r.userId === me,
  )
  const messages = store.messages.filter(
    (m) => m.conversationId === conversation.id && m.deletedAt === null,
  )

  return {
    id: conversation.id,
    kind: conversation.kind,
    memberIds,
    otherUserId,
    otherName: profile?.displayName ?? profile?.fullName ?? profile?.email ?? 'Removed member',
    otherAvatarUrl: profile?.avatarUrl ?? null,
    unread: messages.filter(
      (m) =>
        // Your own words are not news, and a read marker moves forward.
        m.authorId !== me && (!read || m.createdAt > read.lastReadAt),
    ).length,
    lastMessageAt: messages.map((m) => m.createdAt).sort((a, b) => b.localeCompare(a))[0] ?? null,
    lastReadAt: read?.lastReadAt ?? null,
  }
}

/** Most recently spoken in first; one with nothing said in it last. */
function byRecency(a: Conversation, b: Conversation): number {
  if (a.lastMessageAt && b.lastMessageAt) return b.lastMessageAt.localeCompare(a.lastMessageAt)
  if (a.lastMessageAt) return -1
  if (b.lastMessageAt) return 1
  return a.otherName.localeCompare(b.otherName)
}

/**
 * Files on messages.
 *
 * The port of the attachments schema and its storage policies, minus the
 * storage: an upload is remembered as an object URL in this tab, and the rules
 * that matter are the ones about who may attach and who may see — a message
 * you can read, and nothing else.
 */
const demoObjectUrls = new Map<string, string>()

export const demoAttachmentService: AttachmentService = {
  async upload(file) {
    await latency()
    const me = requireCurrentUserId()

    const rejection = rejectAttachment(file)
    // The bucket refuses these before a byte is written; this is the same
    // rule, stated where the demo has no bucket to refuse it.
    if (rejection) throw new AppError('validation', rejection.message)

    // The same shape the storage policy admits: your own prefix, a fresh id.
    const storagePath = `${me}/${crypto.randomUUID()}`
    // A real browser gets a real object URL to render from. Where there is no
    // such API — a test environment — the entry is still made, because what is
    // being stood in for is "storage has this object", and the rules worth
    // testing are about who may ask for it rather than what comes back.
    demoObjectUrls.set(
      storagePath,
      typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : `demo-attachment:${storagePath}`,
    )

    return {
      storagePath,
      fileName: file.name,
      mimeType: uploadTypeOf(file),
      byteSize: file.size,
    }
  },

  async attach(messageId, uploads) {
    await latency()
    const me = requireCurrentUserId()
    const store = db()

    const message = store.messages.find((m) => m.id === messageId)
    if (!message) throw new AppError('not_found', 'That message no longer exists.')
    // Attaching is part of sending: the author's own live message, in a place
    // they may still send to.
    if (message.authorId !== me || message.deletedAt !== null) {
      throw new AppError('forbidden', 'You can only attach to your own message')
    }

    if (message.channelId !== null) {
      const channel = channelById(message.channelId)
      const member = memberOf(me)
      if (!member || !canInChannel(channel, member, 'messages.send')) {
        throw new AppError('forbidden', 'You cannot post in that channel')
      }
    } else {
      assertCanReadConversation(message.conversationId!)
    }

    for (const upload of uploads) {
      // Only your own prefix, the same rule the storage policy states.
      if (upload.storagePath.split('/')[0] !== me) {
        throw new AppError('forbidden', 'That file does not belong to you')
      }
      if (store.attachments.some((a) => a.storagePath === upload.storagePath)) {
        throw new AppError('validation', 'That file is already attached to a message')
      }

      const attachment: DemoAttachment = {
        id: crypto.randomUUID(),
        messageId,
        storagePath: upload.storagePath,
        fileName: upload.fileName.trim().slice(0, 255) || 'attachment',
        mimeType: upload.mimeType,
        byteSize: upload.byteSize,
        createdAt: new Date().toISOString(),
      }
      store.attachments.push(attachment)
    }
    persist()
  },

  async listFor(messageIds) {
    await latency()
    const byMessage = new Map<string, MessageAttachment[]>()
    const wanted = new Set(messageIds)

    for (const attachment of db().attachments) {
      if (!wanted.has(attachment.messageId)) continue

      // An attachment is only visible where its message is.
      const message = db().messages.find((m) => m.id === attachment.messageId)
      if (!message || !canReadMessage(message)) continue

      const list = byMessage.get(attachment.messageId) ?? []
      list.push({ ...attachment })
      byMessage.set(attachment.messageId, list)
    }

    return byMessage
  },

  async signedUrls(paths) {
    await latency()
    const urls = new Map<string, string>()
    const me = db().currentUserId

    for (const path of paths) {
      const url = demoObjectUrls.get(path)
      if (!url) continue

      // Your own object, or one attached to a message you can read — the same
      // two branches the storage policy has.
      const attachment = db().attachments.find((a) => a.storagePath === path)
      const message = attachment
        ? db().messages.find((m) => m.id === attachment.messageId)
        : undefined
      const mine = path.split('/')[0] === me
      if (!mine && (!message || !canReadMessage(message))) continue

      urls.set(path, url)
    }

    return urls
  },

  async discard(paths) {
    await latency()
    const me = db().currentUserId
    for (const path of paths) {
      // Only ever your own, as the delete policy says.
      if (path.split('/')[0] !== me) continue
      const url = demoObjectUrls.get(path)
      if (url?.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url)
      }
      demoObjectUrls.delete(path)
    }
  },
}

export const demoNotificationService: NotificationService = {
  async list(_organizationId, limit = 30) {
    await latency()
    const me = requireCurrentUserId()

    return db()
      .notifications.filter((n) => n.recipientId === me)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((n) => ({
        id: n.id,
        type: n.type,
        entityType: n.entityType,
        entityId: n.entityId,
        actorName: n.actorId ? displayName(n.actorId) : null,
        summary: n.summary,
        metadata: n.metadata,
        readAt: n.readAt,
        createdAt: n.createdAt,
      }))
  },

  async unreadCount() {
    await latency()
    const me = requireCurrentUserId()
    return db().notifications.filter((n) => n.recipientId === me && n.readAt === null).length
  },

  async markRead(ids) {
    await latency()
    const me = requireCurrentUserId()
    const now = new Date().toISOString()

    for (const notification of db().notifications) {
      if (notification.recipientId !== me || notification.readAt !== null) continue
      if (ids && !ids.includes(notification.id)) continue
      notification.readAt = now
    }
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
