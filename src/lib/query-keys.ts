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
    mentions: (placeId: string) => ['messages', placeId, 'mentions'] as const,
    reactions: (placeId: string) => ['messages', placeId, 'reactions'] as const,
    search: (placeId: string | null, query: string) =>
      ['messages', 'search', placeId ?? 'all', query] as const,
  },

  channelMembers: {
    forChannel: (channelId: string) => ['channel-members', channelId] as const,
    mentionable: (placeId: string) => ['mention-candidates', placeId] as const,
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
} as const
