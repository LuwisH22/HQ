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

  messages: {
    list: (channelId: string) => ['messages', channelId] as const,
    pinned: (channelId: string) => ['messages', channelId, 'pinned'] as const,
    replies: (rootMessageId: string) => ['messages', 'thread', rootMessageId] as const,
    reactions: (channelId: string) => ['messages', channelId, 'reactions'] as const,
    search: (channelId: string | null, query: string) =>
      ['messages', 'search', channelId ?? 'all', query] as const,
  },

  channelMembers: {
    forChannel: (channelId: string) => ['channel-members', channelId] as const,
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
