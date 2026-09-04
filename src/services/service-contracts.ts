import type { PermissionSet } from '@/lib/permissions'
import type { InvitationStatus, MemberStatus } from '@/types/database.types'

/**
 * The contract between the application and whatever is behind it.
 *
 * Components depend on these shapes, never on Supabase's. Two implementations
 * satisfy them:
 *
 *   - `src/services/*.service.ts`  — the real Supabase backend (production)
 *   - `src/services/demo/`         — a local store for development (dev only)
 *
 * Keeping the contract in one file is what makes the demo layer possible
 * without touching a single component, and what will let a future backend
 * change stay contained.
 */

// --- Data transfer objects -------------------------------------------------

/** The signed-in identity, deliberately narrower than a Supabase `Session`. */
export interface AuthIdentity {
  id: string
  email: string
}

export interface OrganizationSummary {
  id: string
  slug: string
  name: string
  tagline: string | null
  logoUrl: string | null
  timezone: string
}

export interface MemberRole {
  id: string
  key: string
  name: string
  description: string | null
  rank: number
  isSystem: boolean
}

export interface MemberProfileSummary {
  id: string
  email: string
  fullName: string | null
  displayName: string | null
  avatarUrl: string | null
  title: string | null
  timezone: string
  lastSeenAt: string | null
}

export interface OrganizationMember {
  id: string
  userId: string
  organizationId: string
  status: MemberStatus
  joinedAt: string
  /** Derived primary role: the most authoritative role held. Display only. */
  role: MemberRole
  /** Every role held, most authoritative first. Source of truth. */
  roles: MemberRole[]
  /** NULL with status 'suspended' means indefinite. Never set while banned. */
  suspendedUntil: string | null
  moderationReason: string | null
  profile: MemberProfileSummary
}

/** One entry in the append-only moderation history. */
export interface ModerationAction {
  id: number
  action: 'suspend' | 'unsuspend' | 'ban' | 'unban'
  reason: string | null
  expiresAt: string | null
  createdAt: string
  actorName: string | null
  targetUserId: string
}

/** The signed-in user's own membership, including resolved permissions. */
export interface CurrentMembership {
  membershipId: string
  organizationId: string
  status: MemberStatus
  joinedAt: string
  /** Derived primary role. Authority comes from `permissions` and `rank`. */
  role: MemberRole
  roles: MemberRole[]
  /**
   * Ownership is a column on the organization, never a role. The owner
   * implicitly holds every permission, so no role edit can lock them out.
   */
  isOwner: boolean
  suspendedUntil: string | null
  moderationReason: string | null
  permissions: PermissionSet
}

/** Fields a role editor may set. `rank` is the only hierarchy signal. */
export interface RoleInput {
  name: string
  description: string | null
  rank: number
}

/** One capability, and which roles currently grant it. */
export interface PermissionMatrixRow {
  key: string
  category: string
  label: string
  description: string | null
  grantedRoleIds: ReadonlySet<string>
}

export interface Profile {
  id: string
  email: string
  fullName: string | null
  displayName: string | null
  avatarUrl: string | null
  title: string | null
  bio: string | null
  timezone: string
  lastSeenAt: string | null
}

export interface ProfilePatch {
  fullName?: string | null
  displayName?: string | null
  title?: string | null
  bio?: string | null
  timezone?: string
}

export interface Invitation {
  id: string
  email: string
  status: InvitationStatus
  expiresAt: string
  createdAt: string
  roleId: string
  roleName: string
  invitedByName: string | null
}

export interface CreateInvitationInput {
  organizationId: string
  email: string
  roleId: string
  expiresInDays?: number
}

export interface AuditEntry {
  id: number
  action: string
  entityType: string
  entityId: string | null
  summary: string | null
  createdAt: string
  actor: {
    id: string
    displayName: string | null
    fullName: string | null
    avatarUrl: string | null
  } | null
}

export interface Credentials {
  email: string
  password: string
}

export interface OrganizationPatch {
  name?: string
  tagline?: string | null
  timezone?: string
}

// --- Service interfaces ----------------------------------------------------

export interface AuthService {
  getSession(): Promise<AuthIdentity | null>
  getUser(): Promise<AuthIdentity | null>
  signInWithPassword(credentials: Credentials): Promise<AuthIdentity>
  signInWithMagicLink(email: string): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  updatePassword(password: string): Promise<void>
  signOut(): Promise<void>
  /** Redeem an invitation token for the signed-in user. Returns the org id. */
  acceptInvitation(token: string): Promise<string>
  onAuthStateChange(callback: (identity: AuthIdentity | null) => void): () => void
}

export interface OrganizationService {
  listMine(): Promise<OrganizationSummary[]>
  getCurrentMembership(organizationId: string): Promise<CurrentMembership | null>
  listMembers(organizationId: string): Promise<OrganizationMember[]>
  listRoles(organizationId: string): Promise<MemberRole[]>
  getPermissionMatrix(organizationId: string): Promise<PermissionMatrixRow[]>
  updateMemberRole(membershipId: string, roleId: string): Promise<void>
  removeMember(membershipId: string): Promise<void>
  updateOrganization(organizationId: string, patch: OrganizationPatch): Promise<OrganizationSummary>

  // --- Role management (Phase 1.5 · B1) ---
  // Every one of these is a SECURITY DEFINER routine in Postgres that
  // re-checks permission, hierarchy and delegation. These wrappers exist for
  // ergonomics, not for enforcement.
  createRole(organizationId: string, input: RoleInput): Promise<string>
  updateRole(roleId: string, name: string, description: string | null): Promise<void>
  setRoleRank(roleId: string, rank: number): Promise<void>
  deleteRole(roleId: string): Promise<void>
  setRolePermissions(roleId: string, permissionKeys: readonly string[]): Promise<void>
  assignRole(membershipId: string, roleId: string): Promise<void>
  unassignRole(membershipId: string, roleId: string): Promise<void>

  // --- Moderation (Phase 1.5 · B2) ---
  // `status` is no longer client-writable. Every one of these is a guarded
  // routine in Postgres that records the reason, the actor, the expiry and
  // an append-only history entry, so a moderation decision is always
  // reviewable afterwards.
  //
  // `days: null` suspends indefinitely — a lapsed suspension restores
  // access on its own, an indefinite one needs an explicit lift.
  suspendMember(membershipId: string, reason: string, days: number | null): Promise<void>
  unsuspendMember(membershipId: string, reason?: string): Promise<void>
  /** Also revokes the Auth session server-side; see supabase/functions/moderate-user. */
  banMember(membershipId: string, reason: string): Promise<ModerationResult>
  unbanMember(membershipId: string, reason?: string): Promise<ModerationResult>
  listModerationHistory(organizationId: string, userId?: string): Promise<ModerationAction[]>
}

/**
 * A ban touches two systems. Organization access is revoked by RLS and is
 * never in doubt; the authentication layer is updated through an Edge
 * Function and can fail independently, so the caller is told which happened.
 */
export interface ModerationResult {
  authUpdated: boolean
  warning: string | null
}

export interface ProfileService {
  getMine(): Promise<Profile | null>
  update(patch: ProfilePatch): Promise<Profile>
  touchLastSeen(): Promise<void>
}

export interface InvitationService {
  list(organizationId: string): Promise<Invitation[]>
  create(input: CreateInvitationInput): Promise<{ id: string; email: string }>
  revoke(invitationId: string): Promise<void>
  deleteSpent(invitationId: string): Promise<void>
}

export interface AuditService {
  listRecent(organizationId: string, limit?: number): Promise<AuditEntry[]>
}
