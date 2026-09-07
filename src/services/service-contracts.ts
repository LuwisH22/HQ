import type { PermissionSet } from '@/lib/permissions'
import type {
  CalendarEventType,
  ChannelType,
  InvitationStatus,
  MemberStatus,
} from '@/types/database.types'

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

/**
 * One event in the organization's diary.
 *
 * `startsAt` and `endsAt` are instants, so a viewer in any zone reads the same
 * moment. `timezone` is the zone it was written in, kept so an edit made
 * somewhere else does not silently move it, and so an all-day event's
 * boundaries stay the days their author meant.
 *
 * All-day events run from local midnight to local midnight, end exclusive: a
 * single day ends at the following midnight.
 */
export interface CalendarEvent {
  id: string
  organizationId: string
  title: string
  description: string | null
  location: string | null
  startsAt: string
  endsAt: string
  allDay: boolean
  timezone: string
  eventType: CalendarEventType
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** What a caller supplies to schedule something. */
export interface CalendarEventInput {
  organizationId: string
  title: string
  startsAt: string
  endsAt: string
  allDay?: boolean
  /** IANA zone. Absent means the organization's own. */
  timezone?: string | null
  description?: string | null
  location?: string | null
  eventType?: CalendarEventType
}

/** The window a calendar screen is showing. Both ends are instants. */
export interface CalendarRange {
  organizationId: string
  /** Inclusive lower bound: an event ending after this is in the window. */
  from: string
  /** Exclusive upper bound: an event starting before this is in the window. */
  to: string
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

// --- Channels (Phase 1.5 · B3) ---------------------------------------------

export type OverrideEffect = 'allow' | 'deny'

export interface ChannelCategory {
  id: string
  organizationId: string
  name: string
  position: number
}

export interface Channel {
  id: string
  organizationId: string
  /** null is a real state: an uncategorised channel. */
  categoryId: string | null
  /** URL slug. Carries no authorization meaning, exactly like roles.key. */
  key: string
  name: string
  topic: string | null
  position: number
  /** Private channels are allow-lists: invisible without an explicit ALLOW. */
  isPrivate: boolean
  /**
   * A room for words or a room for voices. Decides which surface the client
   * opens and nothing else: both kinds answer to the same channel
   * authorization, sit in the same categories, and obey the same
   * private/public rule.
   */
  type: ChannelType
  archivedAt: string | null
}

export interface ChannelInput {
  name: string
  topic: string | null
  categoryId: string | null
  isPrivate: boolean
  /** Defaults to text where a caller does not say. */
  type?: ChannelType
}

/** Every field optional: null means "leave this alone". */
export interface ChannelPatch {
  name?: string | null
  topic?: string | null
  categoryId?: string | null
  isPrivate?: boolean | null
  archived?: boolean | null
}

export interface ChannelOverride {
  channelId: string
  roleId: string
  permissionKey: string
  effect: OverrideEffect
}

/**
 * Reads are scoped by RLS through `can_in_channel`, so a channel the caller
 * may not see is absent rather than filtered. Writes go through SECURITY
 * DEFINER routines; none of these tables has a client write policy.
 */
export interface ChannelService {
  listCategories(organizationId: string): Promise<ChannelCategory[]>
  listChannels(organizationId: string): Promise<Channel[]>

  createCategory(organizationId: string, name: string): Promise<string>
  updateCategory(categoryId: string, name: string): Promise<void>
  deleteCategory(categoryId: string): Promise<void>
  reorderCategories(organizationId: string, ids: readonly string[]): Promise<void>

  createChannel(organizationId: string, input: ChannelInput): Promise<string>
  /**
   * A channel and, when `categoryName` names one that does not exist yet, the
   * category holding it — in one atomic step, so a channel that fails to
   * insert cannot leave an empty category behind. A name that matches an
   * existing category reuses it rather than making a second one.
   */
  createChannelInCategory(
    organizationId: string,
    input: { name: string; categoryName: string | null; isPrivate: boolean; type?: ChannelType },
  ): Promise<string>
  updateChannel(channelId: string, patch: ChannelPatch): Promise<void>
  /** Permanent. Archiving via updateChannel is the reversible alternative. */
  deleteChannel(channelId: string): Promise<void>
  reorderChannels(organizationId: string, ids: readonly string[]): Promise<void>

  // --- C2 ---
  /** Unread counts for every channel the caller can see, in one call. */
  unreadCounts(): Promise<ChannelUnread[]>
  /** Records that the caller has read this channel up to now. */
  markRead(channelId: string): Promise<void>
  /**
   * Members who may be mentioned in a channel: those who can actually see it.
   *
   * The same resolution `channel_member_ids` performs, joined to the roster so
   * the composer can offer names rather than uuids.
   */
  listMentionCandidates(channelId: string): Promise<MentionCandidate[]>
  /**
   * The members who can actually see a channel.
   *
   * Resolved in Postgres through the same rules that govern the channel, so a
   * private channel lists the people allowed into it rather than the whole
   * organization.
   */
  listChannelMembers(channelId: string): Promise<string[]>

  listOverrides(channelId: string): Promise<ChannelOverride[]>
  /** `effect: null` clears the override, returning that role to inherit. */
  setOverride(
    channelId: string,
    roleId: string,
    permissionKey: string,
    effect: OverrideEffect | null,
  ): Promise<void>
}

// --- Messages (Phase 2 · C1) -----------------------------------------------

export interface Message {
  id: string
  /**
   * Where it lives. Exactly one of the two is set, which is the same rule the
   * database states as a CHECK constraint.
   */
  channelId: string | null
  conversationId: string | null
  /** null once the author has been removed from the organization. */
  authorId: string | null
  /** Empty for a deleted message: the row survives, the words do not. */
  body: string
  authorName: string
  authorAvatarUrl: string | null
  pinnedAt: string | null
  editedAt: string | null
  deletedAt: string | null
  createdAt: string
  /** Set when this message is a reply. One level only. */
  parentMessageId: string | null
  /** Live replies beneath this message. Maintained by the database. */
  replyCount: number
  lastReplyAt: string | null
}

/**
 * Just enough of a message to say what a reply is answering.
 *
 * Deliberately not a `Message`: the line above a reply needs a name, a few
 * words and whether there were files — and giving it nothing else means a
 * storage path or an author's email cannot reach that row by accident.
 */
export interface ReplyContext {
  id: string
  authorName: string
  /** Empty when the message was deleted; the row survives, the words do not. */
  body: string
  deleted: boolean
  /** How many files rode with it, so the line can say so without naming them. */
  attachmentCount: number
}

export interface MessagePage {
  /** Oldest first, the way a transcript reads. */
  messages: Message[]
  hasMore: boolean
}

/**
 * Reads inherit channel visibility from the `channels` policy, so a message
 * from a channel the caller cannot see is absent rather than filtered. Sending
 * and editing go straight to the table; removal and pinning are routines,
 * because those leave an audit trail.
 */
export interface MessageService {
  /** `before` is the createdAt of the oldest message already held. */
  list(channelId: string, before?: string): Promise<MessagePage>
  getById(messageId: string): Promise<Message | null>
  /** `parentMessageId` makes it a reply in that message's thread. */
  send(channelId: string, body: string, parentMessageId?: string | null): Promise<Message>
  /** A thread's replies, oldest first. */
  listReplies(rootMessageId: string): Promise<Message[]>
  /**
   * What the given messages are, as far as a reply needs to say it.
   *
   * Same visibility as any other read: a parent the caller cannot see is
   * absent from the map, and the line above the reply says so.
   */
  listReplyContexts(messageIds: readonly string[]): Promise<Map<string, ReplyContext>>
  /** Authors only. `messages.moderate` confers removal, never rewriting. */
  edit(messageId: string, body: string): Promise<void>
  /** Soft delete: the author's own, or anyone's with `messages.moderate`. */
  remove(messageId: string, reason?: string): Promise<void>
  setPinned(messageId: string, pinned: boolean): Promise<void>

  // --- C3 · direct messages ---
  //
  // A direct message is a message: editing, deleting, pinning, reacting,
  // replying, mentions and search are the operations above, unchanged,
  // because they address a message by id and never care where it lives. Only
  // the three calls that name a *place* need a second form.
  /** One page of a conversation's history, oldest first. */
  listConversation(conversationId: string, before?: string): Promise<MessagePage>
  sendToConversation(
    conversationId: string,
    body: string,
    parentMessageId?: string | null,
  ): Promise<Message>
  listConversationPinned(conversationId: string): Promise<Message[]>

  // --- C2 ---
  /** Pinned messages in a channel, newest pin first. */
  listPinned(channelId: string): Promise<Message[]>
  /**
   * Reactions on a set of messages, already aggregated per emoji.
   *
   * Fetched for a whole page at once rather than per message: fifty messages
   * is one request, not fifty.
   */
  listReactions(messageIds: readonly string[]): Promise<Map<string, MessageReaction[]>>
  /**
   * Mentions on a set of messages, resolved server-side.
   *
   * Fetched for a whole page at once, like reactions: fifty messages is one
   * request rather than fifty.
   */
  listMentions(messageIds: readonly string[]): Promise<Map<string, MessageMention[]>>
  addReaction(messageId: string, emoji: string): Promise<void>
  removeReaction(messageId: string, emoji: string): Promise<void>
  /**
   * Full text search. `channelId` null searches every channel the caller can
   * see — which is decided by the messages policy, not here.
   */
  search(input: MessageSearchInput): Promise<MessageSearchResult[]>
}

/**
 * Who a message mentions.
 *
 * `handle` is the text as written, so rendering can highlight exactly that
 * span; `userId` is who it resolved to, which survives a rename.
 */
export interface MessageMention {
  userId: string
  handle: string
}

/** One emoji on one message, counted. */
export interface MessageReaction {
  emoji: string
  count: number
  /** Whether the signed-in member is one of the people who reacted. */
  mine: boolean
}

export interface MessageSearchInput {
  query: string
  channelId: string | null
  /**
   * Naming a conversation searches that conversation. Naming neither it nor a
   * channel searches channels only — a search box that quietly started
   * returning private correspondence because the schema grew a column would
   * be the wrong kind of surprise.
   */
  conversationId?: string | null
  before?: string
}

export interface MessageSearchResult {
  id: string
  channelId: string | null
  conversationId: string | null
  /** Empty for a direct message, which is named by who is in it. */
  channelName: string
  channelKey: string
  authorName: string
  body: string
  createdAt: string
  /** Set when the hit is a reply, so a result can say where it lives. */
  parentMessageId: string | null
}

// --- Read state (Phase 2 · C2) ---------------------------------------------

/** Somebody the composer may offer as a mention. */
export interface MentionCandidate {
  userId: string
  /** What typing `@` should insert. */
  handle: string
  displayName: string
  avatarUrl: string | null
  roleName: string
}

export interface ChannelUnread {
  channelId: string
  unread: number
  lastReadAt: string | null
}

// --- Attachments (Phase 2 · C3) --------------------------------------------

/**
 * A file on a message.
 *
 * `mimeType` and `byteSize` are what storage says they are, not what the
 * uploader claimed: a trigger reads them back out of the object. `storagePath`
 * is the object's name, and the only thing a signed URL can be minted from.
 */
export interface MessageAttachment {
  id: string
  messageId: string
  storagePath: string
  fileName: string
  mimeType: string
  byteSize: number
  createdAt: string
}

/** A file that has been uploaded but is not yet on a message. */
export interface UploadedAttachment {
  storagePath: string
  fileName: string
  mimeType: string
  byteSize: number
}

export interface AttachmentService {
  /**
   * Puts the bytes in the bucket under the caller's own prefix.
   *
   * The message does not exist yet, which is the point: the file is uploaded
   * while the composer is still open, and attached only when it is sent.
   */
  upload(file: File): Promise<UploadedAttachment>
  /** Records the metadata against a message the caller has just sent. */
  attach(messageId: string, uploads: readonly UploadedAttachment[]): Promise<void>
  /** Attachments for a page of messages, keyed by message. */
  listFor(messageIds: readonly string[]): Promise<Map<string, MessageAttachment[]>>
  /**
   * Short-lived URLs for objects the caller can read.
   *
   * `download` asks storage for a Content-Disposition, which is what keeps a
   * file the browser might otherwise render as markup a download and nothing
   * else.
   */
  signedUrls(
    paths: readonly string[],
    options?: { download?: boolean },
  ): Promise<Map<string, string>>
  /** Best-effort removal of objects the caller uploaded and did not send. */
  discard(paths: readonly string[]): Promise<void>
}

// --- Conversations (Phase 2 · C3) ------------------------------------------

/**
 * A direct conversation, as the sidebar needs it.
 *
 * `otherUserId` is the person on the other side of a 1-to-1. It is derived
 * from the membership rows rather than stored, so a group conversation later
 * simply has more members and no "other" at all.
 */
export interface Conversation {
  id: string
  kind: string
  memberIds: string[]
  otherUserId: string | null
  otherName: string
  otherAvatarUrl: string | null
  unread: number
  lastMessageAt: string | null
  lastReadAt: string | null
}

export interface ConversationService {
  /** Every conversation the caller is in, most recently active first. */
  list(organizationId: string): Promise<Conversation[]>
  getById(conversationId: string): Promise<Conversation | null>
  /**
   * Opens the 1-to-1 with another member, creating it the first time.
   *
   * Idempotent: a unique index on the sorted pair is what makes a duplicate
   * impossible, so pressing the button twice returns the same conversation.
   */
  startDirect(organizationId: string, userId: string): Promise<string>
  /** Records that the caller has read up to now. Never moves backwards. */
  markRead(conversationId: string): Promise<void>
  /** Who may be mentioned here: the people in the conversation. */
  listMentionCandidates(conversationId: string): Promise<MentionCandidate[]>
}

// --- Notifications (Phase 2 · C2) ------------------------------------------

export interface Notification {
  id: number
  type: string
  entityType: string
  entityId: string
  actorName: string | null
  summary: string
  metadata: Record<string, unknown>
  readAt: string | null
  createdAt: string
}

export interface NotificationService {
  list(organizationId: string, limit?: number): Promise<Notification[]>
  unreadCount(organizationId: string): Promise<number>
  /** `ids` omitted marks every unread one read. */
  markRead(ids?: readonly number[]): Promise<void>
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

export interface CalendarService {
  /**
   * Every event overlapping a window, oldest first.
   *
   * A range rather than a whole calendar: the month on screen is the query,
   * and an organization's diary is not something to download.
   */
  listRange(input: CalendarRange): Promise<CalendarEvent[]>
  create(input: CalendarEventInput): Promise<string>
  update(eventId: string, input: Partial<CalendarEventInput>): Promise<void>
  remove(eventId: string): Promise<void>
}
