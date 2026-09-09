/**
 * Every TanStack Query key in the app, in one place.
 *
 * Centralising them keeps invalidation honest: a mutation can invalidate
 * `queryKeys.members.all(orgId)` without knowing which components are
 * subscribed, and typos become type errors rather than stale screens.
 */
export const queryKeys = {
  session: ['session'] as const,

  profile: {
    me: () => ['profile', 'me'] as const,
    byId: (userId: string) => ['profile', userId] as const,
  },

  organizations: {
    mine: () => ['organizations', 'mine'] as const,
    detail: (organizationId: string) => ['organizations', organizationId] as const,
  },

  membership: {
    current: (organizationId: string) => ['membership', organizationId, 'me'] as const,
  },

  members: {
    all: (organizationId: string) => ['members', organizationId] as const,
    list: (organizationId: string, search: string) =>
      ['members', organizationId, 'list', search] as const,
  },

  roles: {
    all: (organizationId: string) => ['roles', organizationId] as const,
  },

  permissions: {
    catalog: () => ['permissions', 'catalog'] as const,
  },

  invitations: {
    all: (organizationId: string) => ['invitations', organizationId] as const,
  },

  channels: {
    categories: (organizationId: string) => ['channel-categories', organizationId] as const,
    all: (organizationId: string) => ['channels', organizationId] as const,
    overrides: (channelId: string) => ['channel-overrides', channelId] as const,
  },

  // Keyed by the place a message lives, which is a channel id or a
  // conversation id. They are uuids from different tables, so one namespace
  // serves both and the thread panel does not have to know which it has.
  messages: {
    list: (placeId: string) => ['messages', placeId] as const,
    pinned: (placeId: string) => ['messages', placeId, 'pinned'] as const,
    replies: (rootMessageId: string) => ['messages', 'thread', rootMessageId] as const,
    // Keyed by the parents themselves: what a quote says belongs to the
    // message being quoted, not to the page that happens to quote it.
    replyContexts: (placeId: string, parentIds: readonly string[]) =>
      ['messages', placeId, 'reply-contexts', [...parentIds].sort().join('|')] as const,
    mentions: (placeId: string) => ['messages', placeId, 'mentions'] as const,
    reactions: (placeId: string) => ['messages', placeId, 'reactions'] as const,
    search: (placeId: string | null, query: string) =>
      ['messages', 'search', placeId ?? 'all', query] as const,
  },

  channelMembers: {
    forChannel: (channelId: string) => ['channel-members', channelId] as const,
    mentionable: (placeId: string) => ['mention-candidates', placeId] as const,
  },

  attachments: {
    forMessages: (placeId: string, count: number) => ['attachments', placeId, count] as const,
    // Keyed by the objects themselves: a signed URL belongs to a path, not to
    // the message that happens to list it.
    urls: (paths: readonly string[], kind: 'inline' | 'download') =>
      ['attachment-urls', kind, [...paths].sort().join('|')] as const,
  },

  conversations: {
    all: (organizationId: string) => ['conversations', organizationId] as const,
    detail: (conversationId: string) => ['conversations', 'detail', conversationId] as const,
  },

  reads: {
    unread: (organizationId: string) => ['unread', organizationId] as const,
  },

  notifications: {
    all: (organizationId: string) => ['notifications', organizationId] as const,
    unreadCount: (organizationId: string) => ['notifications', organizationId, 'count'] as const,
  },

  audit: {
    recent: (organizationId: string, limit: number) =>
      ['audit', organizationId, 'recent', limit] as const,
  },

  projects: {
    /** Everything projects for an organization, for invalidation after a write. */
    all: (organizationId: string) => ['projects', organizationId] as const,
    list: (organizationId: string) => ['projects', organizationId, 'list'] as const,
    /**
     * Counts and who is working on each project.
     *
     * A sibling of the list rather than part of it: renaming a project and
     * finishing a task are different news, and the row that draws both should
     * not refetch everything when either happens.
     */
    overview: (organizationId: string) => ['projects', organizationId, 'overview'] as const,
    detail: (organizationId: string, projectId: string) =>
      ['projects', organizationId, 'detail', projectId] as const,
    members: (organizationId: string, projectId: string) =>
      ['projects', organizationId, 'detail', projectId, 'members'] as const,
    /**
     * One project's board. Under the project's own key, so archiving or
     * editing a project invalidates its work along with it — and so labels,
     * comments and realtime have somewhere to hang later.
     */
    tasks: (organizationId: string, projectId: string) =>
      ['projects', organizationId, 'detail', projectId, 'tasks'] as const,
    /** A project's own labels: the catalogue the picker and the manager read. */
    labels: (organizationId: string, projectId: string) =>
      ['projects', organizationId, 'detail', projectId, 'labels'] as const,
    /**
     * One task's comments.
     *
     * A sibling of the board rather than a child of it, on purpose: writing a
     * comment must not invalidate the board, and moving a card must not
     * invalidate a conversation. Phase 6.4 gets three families it can wake
     * independently.
     */
    comments: (organizationId: string, taskId: string) =>
      ['projects', organizationId, 'comments', taskId] as const,
    /**
     * Every task's comments at once.
     *
     * A prefix, and only ever used as one: a comment row that arrives without
     * its task — a real delete carries an id and nothing else — cannot be
     * placed, and marking the whole family stale refetches only the one task
     * somebody actually has open.
     */
    commentsAll: (organizationId: string) => ['projects', organizationId, 'comments'] as const,
    /**
     * One project's review conversation.
     *
     * Under the project, not under a task: a review is about the project as a
     * whole, which is the same reason it is a table of its own.
     */
    review: (organizationId: string, projectId: string) =>
      ['projects', organizationId, 'detail', projectId, 'review'] as const,
  },

  calendar: {
    /** One window of one organization's diary. The range is part of the key. */
    range: (organizationId: string, from: string, to: string) =>
      ['calendar', organizationId, 'range', from, to] as const,
    /** Everything calendar for an organization, for invalidation after a write. */
    all: (organizationId: string) => ['calendar', organizationId] as const,
  },
} as const
