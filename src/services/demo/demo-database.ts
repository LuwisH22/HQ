import { PERMISSIONS, type Permission } from '@/lib/permissions'
import type { InvitationStatus, MemberStatus } from '@/types/database.types'

/**
 * The demo mode data store.
 *
 * An in-memory database persisted to `localStorage`, seeded with a realistic
 * esports organization. It mirrors the Phase 1 schema in
 * `supabase/migrations/` one table at a time, so what you exercise locally is
 * the same shape the real backend returns.
 *
 * This module is aliased away entirely in production builds — see
 * `src/lib/demo-mode.ts` and the `resolve.alias` block in `vite.config.ts`.
 */

const STORAGE_KEY = 'lfg-hq-demo-db'
// Bumped when the seed shape changes, so a stale store is discarded rather
// than half-migrated.
const SCHEMA_VERSION = 8

// --- Row shapes (camelCase; the demo layer sits above the SQL naming) -------

export interface DemoOrganization {
  id: string
  slug: string
  name: string
  tagline: string | null
  logoUrl: string | null
  timezone: string
}

export interface DemoProfile {
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

export interface DemoRole {
  id: string
  organizationId: string
  key: string
  name: string
  description: string | null
  rank: number
  isSystem: boolean
}

export interface DemoMember {
  /**
   * Every role held. Optional so a store written before Phase 1.5 still
   * loads: readers fall back to `[roleId]`, which is exactly what the old
   * single-role shape meant.
   */
  roleIds?: string[]
  /** NULL with status 'suspended' means indefinite. Never set while banned. */
  suspendedUntil?: string | null
  moderationReason?: string | null
  moderatedBy?: string | null
  moderatedAt?: string | null
  id: string
  organizationId: string
  userId: string
  roleId: string
  status: MemberStatus
  joinedAt: string
}

export interface DemoInvitation {
  id: string
  organizationId: string
  email: string
  roleId: string
  invitedBy: string | null
  status: InvitationStatus
  expiresAt: string
  createdAt: string
}

export interface DemoAuditLog {
  id: number
  organizationId: string
  actorId: string | null
  action: string
  entityType: string
  entityId: string | null
  summary: string
  createdAt: string
}

export interface DemoDatabase {
  version: number
  /** Which demo profile is "signed in". */
  currentUserId: string | null
  organization: DemoOrganization
  profiles: DemoProfile[]
  roles: DemoRole[]
  rolePermissions: Array<{ roleId: string; permissionKey: Permission }>
  members: DemoMember[]
  invitations: DemoInvitation[]
  auditLogs: DemoAuditLog[]
  nextAuditId: number
  /** Append-only, mirroring the moderation_actions table. */
  moderationActions: DemoModerationAction[]
  nextModerationId: number
  channelCategories: DemoChannelCategory[]
  channels: DemoChannel[]
  channelOverrides: DemoChannelOverride[]
  messages: DemoMessage[]
  reactions: DemoReaction[]
  mentions: DemoMention[]
  channelReads: DemoChannelRead[]
  notifications: DemoNotification[]
}

export interface DemoChannelCategory {
  id: string
  organizationId: string
  name: string
  position: number
}

export interface DemoChannel {
  id: string
  organizationId: string
  categoryId: string | null
  key: string
  name: string
  topic: string | null
  position: number
  isPrivate: boolean
  archivedAt: string | null
}

export interface DemoMessage {
  id: string
  channelId: string
  authorId: string | null
  body: string
  pinnedAt: string | null
  editedAt: string | null
  deletedAt: string | null
  createdAt: string
  /** Set when this message is a reply. One level only. */
  parentMessageId: string | null
  replyCount: number
  lastReplyAt: string | null
}

/** One emoji, one person, one message. The triple is the identity. */
export interface DemoReaction {
  messageId: string
  userId: string
  emoji: string
  channelId: string
}

/** Who a message mentions. Written only by the mention pass, never by a caller. */
export interface DemoMention {
  messageId: string
  userId: string
  handle: string
}

export interface DemoChannelRead {
  channelId: string
  userId: string
  lastReadAt: string
}

export interface DemoNotification {
  id: number
  recipientId: string
  type: string
  entityType: string
  entityId: string
  actorId: string | null
  summary: string
  metadata: Record<string, unknown>
  readAt: string | null
  createdAt: string
}

export interface DemoChannelOverride {
  channelId: string
  roleId: string
  permissionKey: string
  effect: 'allow' | 'deny'
}

export interface DemoModerationAction {
  id: number
  targetMemberId: string
  targetUserId: string
  actorId: string | null
  action: 'suspend' | 'unsuspend' | 'ban' | 'unban'
  reason: string | null
  expiresAt: string | null
  createdAt: string
}

// --- Identifiers -----------------------------------------------------------

/**
 * Deterministic, *well-formed* UUIDs for the seed rows.
 *
 * The real schema uses `uuid` primary keys and the invite form validates role
 * ids with `z.string().uuid()`. Readable ids like `demo-role-player` would fail
 * that check, which would mean either weakening production validation or
 * discovering the difference only against the real backend. Neither is
 * acceptable, so demo ids are shaped exactly like the real ones.
 *
 * `group` separates entity kinds; `index` is stable across restarts so the
 * persisted store keeps referring to the same rows.
 */
function demoId(group: number, index: number): string {
  const g = group.toString(16).padStart(2, '0')
  const i = index.toString(16).padStart(4, '0')
  return `${g}000000-0000-4000-8000-${i}00000000`
}

const GROUP = {
  organization: 1,
  role: 2,
  profile: 3,
  member: 4,
  invitation: 5,
  category: 6,
  channel: 7,
  message: 8,
} as const

const ROLE_KEYS = ['owner', 'admin', 'manager', 'coach', 'player', 'staff'] as const

/** role key -> uuid, so the seed can reference roles by name. */
const ROLE_ID: Record<string, string> = Object.fromEntries(
  ROLE_KEYS.map((key, index) => [key, demoId(GROUP.role, index)]),
)

/** The seeded Owner. Demo sign-in adopts this identity. */
export const DEMO_OWNER_PROFILE_ID = demoId(GROUP.profile, 0)

// --- Seed ------------------------------------------------------------------

const ORG_ID = demoId(GROUP.organization, 0)

/**
 * Role permissions, mirroring `role_template_permissions` in
 * `supabase/migrations/20250901000200_permissions_catalog.sql`.
 * `demo-database.test.ts` asserts the two stay consistent in shape.
 */
const MANAGER_PERMISSIONS: Permission[] = [
  'organization.view',
  'members.view',
  'members.invite',
  'members.manage',
  'roles.view',
  'channels.view',
  'channels.create',
  'channels.manage',
  'messages.send',
  'messages.pin',
  'messages.moderate',
  'projects.view',
  'projects.create',
  'projects.manage',
  'projects.delete',
  'tasks.view',
  'tasks.create',
  'tasks.assign',
  'tasks.manage',
  'calendar.view',
  'calendar.create',
  'calendar.manage',
  'teams.view',
  'teams.manage',
  'teams.roster_manage',
  'files.view',
  'files.upload',
  'files.manage',
]

const COACH_PERMISSIONS: Permission[] = [
  'organization.view',
  'members.view',
  'channels.view',
  'channels.create',
  'messages.send',
  'messages.pin',
  'projects.view',
  'projects.create',
  'projects.manage',
  'tasks.view',
  'tasks.create',
  'tasks.assign',
  'tasks.manage',
  'calendar.view',
  'calendar.create',
  'calendar.manage',
  'teams.view',
  'teams.roster_manage',
  'files.view',
  'files.upload',
]

const PLAYER_PERMISSIONS: Permission[] = [
  'organization.view',
  'members.view',
  'channels.view',
  'messages.send',
  'projects.view',
  'tasks.view',
  'calendar.view',
  'teams.view',
  'files.view',
  'files.upload',
]

const STAFF_PERMISSIONS: Permission[] = PLAYER_PERMISSIONS.filter((p) => p !== 'files.upload')

const ROLE_SEED: Array<{
  key: string
  name: string
  description: string
  rank: number
  permissions: Permission[]
}> = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Full control of the organization, including ownership transfer.',
    rank: 0,
    permissions: [...PERMISSIONS],
  },
  {
    key: 'admin',
    name: 'Admin',
    description: 'Manages members, permissions, channels and files.',
    rank: 10,
    permissions: PERMISSIONS.filter((p) => p !== 'organization.delete'),
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Runs projects, teams, the calendar and channels.',
    rank: 20,
    permissions: MANAGER_PERMISSIONS,
  },
  {
    key: 'coach',
    name: 'Coach',
    description: 'Manages their teams, schedules and team projects.',
    rank: 30,
    permissions: COACH_PERMISSIONS,
  },
  {
    key: 'player',
    name: 'Player',
    description: 'Works assigned tasks, team channels, calendar and DMs.',
    rank: 40,
    permissions: PLAYER_PERMISSIONS,
  },
  {
    key: 'staff',
    name: 'Staff',
    description: 'Baseline access, extended per organization as needed.',
    rank: 50,
    permissions: STAFF_PERMISSIONS,
  },
]

/** Fictional people. Nothing here corresponds to a real individual. */
const PEOPLE_SEED: Array<{
  email: string
  fullName: string
  displayName: string
  title: string
  bio: string | null
  roleKey: string
  seenMinutesAgo: number | null
  joinedDaysAgo: number
  status?: MemberStatus
}> = [
  {
    email: 'demo.owner@lfg.test',
    fullName: 'Riley Vance',
    displayName: 'vance',
    title: 'Founder & Owner',
    bio: 'Running the org. Ping me for anything structural or contractual.',
    roleKey: 'owner',
    seenMinutesAgo: 0,
    joinedDaysAgo: 720,
  },
  {
    email: 'demo.admin@lfg.test',
    fullName: 'Jordan Okafor',
    displayName: 'jokafor',
    title: 'Operations Admin',
    bio: 'Travel, visas, tournament registrations.',
    roleKey: 'admin',
    seenMinutesAgo: 3,
    joinedDaysAgo: 540,
  },
  {
    email: 'demo.manager@lfg.test',
    fullName: 'Sam Petrov',
    displayName: 'spetrov',
    title: 'Team Manager — Valorant',
    bio: 'Scrim blocks, bootcamps, and keeping the calendar honest.',
    roleKey: 'manager',
    seenMinutesAgo: 11,
    joinedDaysAgo: 400,
  },
  {
    email: 'demo.coach@lfg.test',
    fullName: 'Ana Ferreira',
    displayName: 'anaf',
    title: 'Head Coach — Valorant',
    bio: 'VOD reviews Tuesdays and Fridays. Bring notes.',
    roleKey: 'coach',
    seenMinutesAgo: 26,
    joinedDaysAgo: 365,
  },
  {
    email: 'demo.analyst@lfg.test',
    fullName: 'Tobias Lindqvist',
    displayName: 'tobi',
    title: 'Assistant Coach & Analyst',
    bio: 'Opponent prep and map veto data.',
    roleKey: 'coach',
    seenMinutesAgo: 140,
    joinedDaysAgo: 210,
  },
  {
    email: 'demo.player1@lfg.test',
    fullName: 'Kai Nakamura',
    displayName: 'kaidrop',
    title: 'Entry Fragger',
    bio: 'Scrims 18:00–22:00 CET. DM before 14:00 if plans change.',
    roleKey: 'player',
    seenMinutesAgo: 2,
    joinedDaysAgo: 300,
  },
  {
    email: 'demo.player2@lfg.test',
    fullName: 'Noor Haddad',
    displayName: 'noorx',
    title: 'Controller',
    bio: null,
    roleKey: 'player',
    seenMinutesAgo: 18,
    joinedDaysAgo: 300,
  },
  {
    email: 'demo.player3@lfg.test',
    fullName: 'Diego Marchetti',
    displayName: 'dmarch',
    title: 'Sentinel',
    bio: null,
    roleKey: 'player',
    seenMinutesAgo: 2880,
    joinedDaysAgo: 95,
  },
  {
    email: 'demo.trial@lfg.test',
    fullName: 'Priya Raman',
    displayName: 'praman',
    title: 'Duelist — Trial',
    bio: 'Two-week trial with the Valorant roster.',
    roleKey: 'player',
    seenMinutesAgo: 55,
    joinedDaysAgo: 12,
  },
  {
    email: 'demo.staff@lfg.test',
    fullName: 'Morgan Ellis',
    displayName: 'mellis',
    title: 'Content Producer',
    bio: 'Clips, socials, match-day graphics.',
    roleKey: 'staff',
    seenMinutesAgo: 480,
    joinedDaysAgo: 260,
  },
  {
    email: 'demo.former@lfg.test',
    fullName: 'Chris Bello',
    displayName: 'cbello',
    title: 'Content Editor',
    bio: null,
    roleKey: 'staff',
    seenMinutesAgo: null,
    joinedDaysAgo: 180,
    status: 'suspended',
  },
]

const AUDIT_SEED: Array<{ action: string; summary: string; minutesAgo: number; actor: string }> = [
  {
    action: 'invitation.created',
    summary: 'Invited demo.tryout@lfg.test as Player',
    minutesAgo: 42,
    actor: demoId(GROUP.profile, 0),
  },
  {
    action: 'member.role_changed',
    summary: 'Tobias Lindqvist changed to Coach',
    minutesAgo: 190,
    actor: demoId(GROUP.profile, 1),
  },
  {
    action: 'member.suspended',
    summary: 'Chris Bello access suspended',
    minutesAgo: 400,
    actor: demoId(GROUP.profile, 0),
  },
  {
    action: 'organization.updated',
    summary: 'Default timezone set to Europe/Berlin',
    minutesAgo: 1400,
    actor: demoId(GROUP.profile, 0),
  },
  {
    action: 'invitation.accepted',
    summary: 'Priya Raman joined the organization',
    minutesAgo: 17_280,
    actor: demoId(GROUP.profile, 8),
  },
  {
    action: 'member.added',
    summary: 'Kai Nakamura joined as Player',
    minutesAgo: 43_200,
    actor: demoId(GROUP.profile, 0),
  },
]

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

function buildSeed(): DemoDatabase {
  const roles: DemoRole[] = ROLE_SEED.map((role) => ({
    id: ROLE_ID[role.key] as string,
    organizationId: ORG_ID,
    key: role.key,
    name: role.name,
    description: role.description,
    rank: role.rank,
    isSystem: true,
  }))

  const rolePermissions = ROLE_SEED.flatMap((role) =>
    role.permissions.map((permissionKey) => ({
      roleId: ROLE_ID[role.key] as string,
      permissionKey,
    })),
  )

  const profiles: DemoProfile[] = PEOPLE_SEED.map((person, index) => ({
    id: demoId(GROUP.profile, index),
    email: person.email,
    fullName: person.fullName,
    displayName: person.displayName,
    avatarUrl: null,
    title: person.title,
    bio: person.bio,
    timezone: 'Europe/Berlin',
    lastSeenAt: person.seenMinutesAgo === null ? null : minutesAgo(person.seenMinutesAgo),
  }))

  const members: DemoMember[] = PEOPLE_SEED.map((person, index) => ({
    id: demoId(GROUP.member, index),
    organizationId: ORG_ID,
    userId: demoId(GROUP.profile, index),
    roleId: ROLE_ID[person.roleKey] as string,
    status: person.status ?? 'active',
    joinedAt: daysAgo(person.joinedDaysAgo),
  }))

  const invitations: DemoInvitation[] = [
    {
      id: demoId(GROUP.invitation, 0),
      organizationId: ORG_ID,
      email: 'demo.tryout@lfg.test',
      roleId: ROLE_ID.player as string,
      invitedBy: demoId(GROUP.profile, 0),
      status: 'pending',
      expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      createdAt: minutesAgo(42),
    },
    {
      id: demoId(GROUP.invitation, 1),
      organizationId: ORG_ID,
      email: 'demo.videographer@lfg.test',
      roleId: ROLE_ID.staff as string,
      invitedBy: demoId(GROUP.profile, 1),
      status: 'pending',
      expiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      createdAt: daysAgo(5),
    },
    {
      id: demoId(GROUP.invitation, 2),
      organizationId: ORG_ID,
      email: 'demo.lapsed@lfg.test',
      roleId: ROLE_ID.player as string,
      invitedBy: demoId(GROUP.profile, 0),
      status: 'pending',
      expiresAt: daysAgo(2),
      createdAt: daysAgo(12),
    },
  ]

  const auditLogs: DemoAuditLog[] = AUDIT_SEED.map((entry, index) => ({
    id: index + 1,
    organizationId: ORG_ID,
    actorId: entry.actor,
    action: entry.action,
    entityType: 'organization',
    entityId: null,
    summary: entry.summary,
    createdAt: minutesAgo(entry.minutesAgo),
  }))

  return {
    version: SCHEMA_VERSION,
    moderationActions: [],
    nextModerationId: 1,
    channelCategories: [
      { id: demoId(GROUP.category, 0), organizationId: ORG_ID, name: 'INFORMATION', position: 0 },
      { id: demoId(GROUP.category, 1), organizationId: ORG_ID, name: 'GENERAL', position: 1 },
      { id: demoId(GROUP.category, 2), organizationId: ORG_ID, name: 'MANAGEMENT', position: 2 },
    ],
    channels: [
      {
        id: demoId(GROUP.channel, 0),
        organizationId: ORG_ID,
        categoryId: demoId(GROUP.category, 0),
        key: 'announcements',
        name: 'announcements',
        topic: 'Org-wide notices',
        position: 0,
        isPrivate: false,
        archivedAt: null,
      },
      {
        id: demoId(GROUP.channel, 1),
        organizationId: ORG_ID,
        categoryId: demoId(GROUP.category, 1),
        key: 'general',
        name: 'general',
        topic: 'Everything else',
        position: 1,
        isPrivate: false,
        archivedAt: null,
      },
      {
        id: demoId(GROUP.channel, 2),
        organizationId: ORG_ID,
        categoryId: demoId(GROUP.category, 2),
        key: 'management',
        name: 'management',
        topic: 'Staff only',
        position: 2,
        // Private: invisible without an explicit ALLOW, not merely hidden.
        isPrivate: true,
        archivedAt: null,
      },
    ],
    channelOverrides: [],
    reactions: [],
    mentions: [],
    channelReads: [],
    notifications: [],
    messages: [
      {
        id: demoId(GROUP.message, 0),
        channelId: demoId(GROUP.channel, 1),
        authorId: DEMO_OWNER_PROFILE_ID,
        body: 'Scrim block moved to 19:00 CET. Same opponent.',
        pinnedAt: null,
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        replyCount: 0,
        lastReplyAt: null,
        createdAt: new Date(Date.now() - 45 * 60_000).toISOString(),
      },
      {
        id: demoId(GROUP.message, 1),
        channelId: demoId(GROUP.channel, 1),
        authorId: demoId(GROUP.profile, 1),
        body: 'Confirmed. VOD review straight after.',
        pinnedAt: null,
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        replyCount: 0,
        lastReplyAt: null,
        createdAt: new Date(Date.now() - 40 * 60_000).toISOString(),
      },
    ],
    currentUserId: null,
    organization: {
      id: ORG_ID,
      slug: 'lfg-demo',
      name: 'LFG Esports',
      tagline: 'Competitive since day one.',
      logoUrl: null,
      timezone: 'Europe/Berlin',
    },
    profiles,
    roles,
    rolePermissions,
    members,
    invitations,
    auditLogs,
    nextAuditId: auditLogs.length + 1,
  }
}

// --- Persistence -----------------------------------------------------------

let cache: DemoDatabase | null = null

function isDemoDatabase(value: unknown): value is DemoDatabase {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DemoDatabase>
  return (
    candidate.version === SCHEMA_VERSION &&
    Array.isArray(candidate.profiles) &&
    Array.isArray(candidate.members) &&
    Array.isArray(candidate.roles)
  )
}

/**
 * The current database. Read from `localStorage` on first access, reseeded if
 * absent, corrupt, or written by an older schema version.
 */
export function db(): DemoDatabase {
  if (cache) return cache

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isDemoDatabase(parsed)) {
        cache = parsed
        return cache
      }
    }
  } catch {
    // Unreadable or unparseable — fall through and reseed.
  }

  cache = buildSeed()
  persist()
  return cache
}

/** Write the working copy back to storage. Called after every mutation. */
export function persist(): void {
  if (!cache) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Storage full or blocked: the session continues from memory.
    console.warn('Demo mode: could not persist to localStorage; changes are in memory only.')
  }
}

/** Discard all local changes and rebuild the seed. */
export function resetDemoDatabase(): void {
  cache = buildSeed()
  persist()
}

/** Test seam: drops the in-memory copy so the next `db()` re-reads storage. */
export function clearDemoCache(): void {
  cache = null
}

/** Append an audit entry, mirroring `log_audit_event`. */
export function recordAudit(
  action: string,
  entityType: string,
  entityId: string | null,
  summary: string,
): void {
  const database = db()
  database.auditLogs.unshift({
    id: database.nextAuditId++,
    organizationId: database.organization.id,
    actorId: database.currentUserId,
    action,
    entityType,
    entityId,
    summary,
    createdAt: new Date().toISOString(),
  })
}

/** A small delay so loading states and skeletons are actually exercised. */
export function latency(): Promise<void> {
  const ms = 90 + Math.random() * 120
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function newId(): string {
  // Matches the shape of a real uuid primary key.
  return crypto.randomUUID()
}
