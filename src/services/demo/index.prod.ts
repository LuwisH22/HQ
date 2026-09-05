import type {
  AuditService,
  AuthService,
  AttachmentService,
  ChannelService,
  ConversationService,
  MessageService,
  InvitationService,
  NotificationService,
  OrganizationService,
  ProfileService,
} from '../service-contracts'

/**
 * Production stand-in for the demo backend.
 *
 * `vite.config.ts` aliases `@/services/demo` to this file for every
 * non-development build, so the demo implementation, its seed data and its
 * fictional accounts are physically absent from the shipped bundle.
 *
 * Nothing here is reachable: `isDemoModeAvailable()` is a compile-time `false`
 * in a production build, so no dispatcher ever selects these objects. They
 * throw rather than no-op so that a future wiring mistake fails loudly instead
 * of silently returning empty data.
 */

function unreachable(): never {
  throw new Error('Demo mode is not available in production builds.')
}

export const demoAuthService: AuthService = {
  getSession: unreachable,
  getUser: unreachable,
  signInWithPassword: unreachable,
  signInWithMagicLink: unreachable,
  requestPasswordReset: unreachable,
  updatePassword: unreachable,
  signOut: unreachable,
  acceptInvitation: unreachable,
  onAuthStateChange: unreachable,
}

export const demoOrganizationService: OrganizationService = {
  listMine: unreachable,
  getCurrentMembership: unreachable,
  listMembers: unreachable,
  listRoles: unreachable,
  getPermissionMatrix: unreachable,
  updateMemberRole: unreachable,
  removeMember: unreachable,
  updateOrganization: unreachable,
  createRole: unreachable,
  updateRole: unreachable,
  setRoleRank: unreachable,
  deleteRole: unreachable,
  setRolePermissions: unreachable,
  assignRole: unreachable,
  unassignRole: unreachable,
  suspendMember: unreachable,
  unsuspendMember: unreachable,
  banMember: unreachable,
  unbanMember: unreachable,
  listModerationHistory: unreachable,
}

export const demoChannelService: ChannelService = {
  listCategories: unreachable,
  listChannels: unreachable,
  createCategory: unreachable,
  updateCategory: unreachable,
  deleteCategory: unreachable,
  reorderCategories: unreachable,
  createChannel: unreachable,
  createChannelInCategory: unreachable,
  updateChannel: unreachable,
  deleteChannel: unreachable,
  reorderChannels: unreachable,
  listOverrides: unreachable,
  setOverride: unreachable,
  unreadCounts: unreachable,
  markRead: unreachable,
  listMentionCandidates: unreachable,
  listChannelMembers: unreachable,
}

export const demoMessageService: MessageService = {
  list: unreachable,
  getById: unreachable,
  send: unreachable,
  listConversation: unreachable,
  sendToConversation: unreachable,
  listConversationPinned: unreachable,
  listReplies: unreachable,
  edit: unreachable,
  remove: unreachable,
  setPinned: unreachable,
  listPinned: unreachable,
  listReactions: unreachable,
  listMentions: unreachable,
  addReaction: unreachable,
  removeReaction: unreachable,
  search: unreachable,
}

export const demoConversationService: ConversationService = {
  list: unreachable,
  getById: unreachable,
  startDirect: unreachable,
  markRead: unreachable,
  listMentionCandidates: unreachable,
}

export const demoAttachmentService: AttachmentService = {
  upload: unreachable,
  attach: unreachable,
  listFor: unreachable,
  signedUrls: unreachable,
  discard: unreachable,
}

export const demoNotificationService: NotificationService = {
  list: unreachable,
  unreadCount: unreachable,
  markRead: unreachable,
}

export const demoProfileService: ProfileService = {
  getMine: unreachable,
  update: unreachable,
  touchLastSeen: unreachable,
}

export const demoInvitationService: InvitationService = {
  list: unreachable,
  create: unreachable,
  revoke: unreachable,
  deleteSpent: unreachable,
}

export const demoAuditService: AuditService = {
  listRecent: unreachable,
}

export function signInAsDemoAdmin(): Promise<void> {
  return unreachable()
}

export function resetDemoData(): void {
  unreachable()
}
