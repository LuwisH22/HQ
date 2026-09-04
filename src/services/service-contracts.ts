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
  role: MemberRole
  profile: MemberProfileSummary
}

/** The signed-in user's own membership, including resolved permissions. */
export interface CurrentMembership {
  membershipId: string
  organizationId: string
  status: MemberStatus
  joinedAt: string
  role: MemberRole
  permissions: PermissionSet
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
  updateMemberStatus(membershipId: string, status: MemberStatus): Promise<void>
  removeMember(membershipId: string): Promise<void>
  updateOrganization(organizationId: string, patch: OrganizationPatch): Promise<OrganizationSummary>
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
