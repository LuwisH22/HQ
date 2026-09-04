import { AppError } from '@/lib/errors'
import { canActOnRank, canGrantRank, isPermission, PermissionSet } from '@/lib/permissions'
import { endDemoSession, isDemoSessionActive, startDemoSession } from '@/lib/demo-mode'
import type { MemberStatus } from '@/types/database.types'
import type {
  AuditEntry,
  AuditService,
  AuthIdentity,
  AuthService,
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
  type DemoMember,
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

function currentRank(): number | null {
  const membership = memberOf(requireCurrentUserId())
  if (!membership || membership.status !== 'active') return null
  return roleById(membership.roleId).rank
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
  if (!membership || !permissionsFor(membership.roleId).can(permission)) {
    throw new AppError('forbidden', message)
  }
}

/** Mirrors the rank and last-owner guards in `tg_guard_member_changes`. */
function assertCanActOnMember(target: DemoMember, options: { newRoleId?: string } = {}): void {
  const actorId = requireCurrentUserId()
  const actorRank = currentRank()
  const targetRank = roleById(target.roleId).rank
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

  // The organization must always retain at least one active owner.
  if (targetRank === 0) {
    const otherActiveOwners = db().members.filter(
      (m) => m.id !== target.id && m.status === 'active' && roleById(m.roleId).rank === 0,
    ).length
    if (otherActiveOwners === 0) {
      throw new AppError('validation', 'The organization must keep at least one active owner')
    }
  }
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
      permissions: permissionsFor(membership.roleId),
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
    member.roleId = roleId
    recordAudit(
      'member.role_changed',
      'organization_member',
      member.id,
      `${displayName(member.userId)} changed from ${previous} to ${roleById(roleId).name}`,
    )
    persist()
  },

  async updateMemberStatus(membershipId, status: MemberStatus) {
    await latency()
    assertPermission('members.manage', 'You do not have permission to manage members.')

    const member = db().members.find((m) => m.id === membershipId)
    if (!member) throw new AppError('not_found', 'That member no longer exists.')

    assertCanActOnMember(member)

    member.status = status
    recordAudit(
      status === 'suspended' ? 'member.suspended' : 'member.reactivated',
      'organization_member',
      member.id,
      `${displayName(member.userId)} ${status === 'suspended' ? 'access suspended' : 'access restored'}`,
    )
    persist()
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
