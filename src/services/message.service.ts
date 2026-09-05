import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { demoMessageService } from '@/services/demo'
import { attachmentService } from './attachment.service'
import { firstOf } from './postgrest'
import type {
  Message,
  MessageMention,
  MessagePage,
  MessageReaction,
  MessageSearchInput,
  MessageSearchResult,
  MessageService,
  ReplyContext,
} from './service-contracts'

export type {
  Message,
  MessageMention,
  MessagePage,
  MessageReaction,
  MessageSearchInput,
  MessageSearchResult,
  ReplyContext,
} from './service-contracts'

/**
 * Channel messages.
 *
 * Reads are scoped by RLS, which defers to the channels policy and therefore
 * to `can_in_channel` — so a message from a channel the caller cannot see is
 * absent from the response rather than filtered out here. Sending and editing
 * go straight to the table under `with check`; only removal and pinning need a
 * routine, because those carry an audit trail.
 */

const COLUMNS = `id, channel_id, conversation_id, author_id, body, pinned_at, edited_at, deleted_at, created_at,
   parent_message_id, reply_count, last_reply_at,
   author:profiles!messages_author_id_fkey ( id, display_name, full_name, email, avatar_url )`

interface MessageRow {
  id: string
  channel_id: string | null
  conversation_id: string | null
  author_id: string | null
  body: string
  pinned_at: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
  parent_message_id: string | null
  reply_count: number
  last_reply_at: string | null
  author: unknown
}

function toMessage(row: MessageRow): Message {
  const author = firstOf(row.author) as {
    id: string
    display_name: string | null
    full_name: string | null
    email: string
    avatar_url: string | null
  } | null

  return {
    id: row.id,
    channelId: row.channel_id,
    conversationId: row.conversation_id,
    authorId: row.author_id,
    // A deleted message keeps its row so replies survive; the body is gone.
    body: row.deleted_at === null ? row.body : '',
    authorName: author?.display_name ?? author?.full_name ?? author?.email ?? 'Removed member',
    authorAvatarUrl: author?.avatar_url ?? null,
    pinnedAt: row.pinned_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    parentMessageId: row.parent_message_id,
    replyCount: row.reply_count,
    lastReplyAt: row.last_reply_at,
  }
}

/** One page of history. 50 keeps the first paint quick on a slow connection. */
const PAGE_SIZE = 50

export const supabaseMessageService: MessageService = {
  /**
   * Newest-first, keyset paginated.
   *
   * `before` is the createdAt of the oldest message already held. OFFSET would
   * drift as new messages arrive mid-scroll and would slow down as history
   * grows; a cursor does neither.
   */
  async list(channelId: string, before?: string): Promise<MessagePage> {
    let query = getSupabase()
      .from('messages')
      .select(COLUMNS)
      .eq('channel_id', channelId)
      // Replies included: a reply is a message in the room, carrying a line
      // that says what it answers. The thread panel is the same rows read a
      // second way, not a place they are hidden in.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1)

    if (before) query = query.lt('created_at', before)

    const { data, error } = await query
    if (error) throw toAppError(error)

    const rows = (data ?? []) as unknown as MessageRow[]
    const hasMore = rows.length > PAGE_SIZE
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows

    // Oldest first, which is how a transcript reads.
    return { messages: page.map(toMessage).reverse(), hasMore }
  },

  /**
   * The same page, in a conversation.
   *
   * Deliberately a second method rather than a second implementation: what
   * differs between a channel and a conversation is one column in the filter,
   * and everything that addresses a message by id — editing, deleting,
   * pinning, reacting, replying — is shared unchanged.
   */
  async listConversation(conversationId: string, before?: string): Promise<MessagePage> {
    let query = getSupabase()
      .from('messages')
      .select(COLUMNS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1)

    if (before) query = query.lt('created_at', before)

    const { data, error } = await query
    if (error) throw toAppError(error)

    const rows = (data ?? []) as unknown as MessageRow[]
    const hasMore = rows.length > PAGE_SIZE
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows

    return { messages: page.map(toMessage).reverse(), hasMore }
  },

  async getById(messageId: string): Promise<Message | null> {
    const { data, error } = await getSupabase()
      .from('messages')
      .select(COLUMNS)
      .eq('id', messageId)
      .maybeSingle()

    if (error) throw toAppError(error)
    return data ? toMessage(data) : null
  },

  async send(
    channelId: string,
    body: string,
    parentMessageId: string | null = null,
  ): Promise<Message> {
    const supabase = getSupabase()

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) throw new AppError('auth', 'Your session has expired. Please sign in again.')

    // author_id is set from the session, and the INSERT policy checks it again
    // against auth.uid() — posting under another name is refused twice.
    const { data, error } = await supabase
      .from('messages')
      .insert({
        channel_id: channelId,
        author_id: userId,
        body: body.trim(),
        parent_message_id: parentMessageId,
      })
      .select(COLUMNS)
      .single()

    if (error) throw toAppError(error)
    return toMessage(data)
  },

  async sendToConversation(
    conversationId: string,
    body: string,
    parentMessageId: string | null = null,
  ): Promise<Message> {
    const supabase = getSupabase()

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) throw new AppError('auth', 'Your session has expired. Please sign in again.')

    // No channel_id at all: the CHECK constraint refuses a message that claims
    // to be in two places, and the INSERT policy asks can_in_conversation.
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        author_id: userId,
        body: body.trim(),
        parent_message_id: parentMessageId,
      })
      .select(COLUMNS)
      .single()

    if (error) throw toAppError(error)
    return toMessage(data)
  },

  async edit(messageId: string, body: string): Promise<void> {
    // Only the body is sent: a trigger refuses any other column from a client,
    // and stamps edited_at itself so it cannot be forged.
    const { error } = await getSupabase()
      .from('messages')
      .update({ body: body.trim() })
      .eq('id', messageId)

    if (error) throw toAppError(error)
  },

  /** Soft delete. The author may remove their own; a moderator, anyone's. */
  async remove(messageId: string, reason?: string): Promise<void> {
    // Read the paths first: deleting the message takes the metadata with it,
    // and after that there is nothing left to say which objects were its.
    const attached = await attachmentService.listFor([messageId])

    const { error } = await getSupabase().rpc('delete_message', {
      p_message_id: messageId,
      p_reason: reason ?? null,
    })
    if (error) throw toAppError(error)

    // Best effort, and only the caller's own objects — the storage policy
    // admits nothing outside their prefix, so a moderator removing somebody
    // else's message leaves the bytes behind. That is the documented limit of
    // cleanup without a worker, and those objects are unreachable rather than
    // exposed: with no attachment row, only their uploader can read them.
    const paths = (attached.get(messageId) ?? []).map((a) => a.storagePath)
    if (paths.length > 0) await attachmentService.discard(paths)
  },

  async setPinned(messageId: string, pinned: boolean): Promise<void> {
    const { error } = await getSupabase().rpc('pin_message', {
      p_message_id: messageId,
      p_pinned: pinned,
    })
    if (error) throw toAppError(error)
  },

  /**
   * A thread's replies, oldest first.
   *
   * Visibility needs no extra rule: a reply is a message in the same channel,
   * so the policy that decided the root already decided these.
   */
  async listReplies(rootMessageId: string): Promise<Message[]> {
    const { data, error } = await getSupabase()
      .from('messages')
      .select(COLUMNS)
      .eq('parent_message_id', rootMessageId)
      .order('created_at', { ascending: true })

    if (error) throw toAppError(error)
    return ((data ?? []) as unknown as MessageRow[]).map(toMessage)
  },

  /**
   * The parents of a page of replies, in one call.
   *
   * A narrow projection on purpose. The line above a reply needs a name, the
   * words and a count of files; asking for exactly that means the row cannot
   * carry a storage path or an address into the timeline even by mistake.
   */
  async listReplyContexts(messageIds: readonly string[]): Promise<Map<string, ReplyContext>> {
    const out = new Map<string, ReplyContext>()
    if (messageIds.length === 0) return out

    const { data, error } = await getSupabase()
      .from('messages')
      .select(
        `id, body, deleted_at,
         author:profiles!messages_author_id_fkey ( display_name, full_name, email ),
         attachments:message_attachments ( id )`,
      )
      .in('id', [...new Set(messageIds)])

    if (error) throw toAppError(error)

    for (const row of (data ?? []) as unknown as {
      id: string
      body: string
      deleted_at: string | null
      author: unknown
      attachments: unknown
    }[]) {
      const author = firstOf(row.author) as {
        display_name: string | null
        full_name: string | null
        email: string
      } | null

      out.set(row.id, {
        id: row.id,
        authorName: author?.display_name ?? author?.full_name ?? author?.email ?? 'Removed member',
        body: row.deleted_at === null ? row.body : '',
        deleted: row.deleted_at !== null,
        attachmentCount: Array.isArray(row.attachments) ? row.attachments.length : 0,
      })
    }

    return out
  },

  /** Newest pin first, and never a deleted message: a trigger unpins those. */
  async listPinned(channelId: string): Promise<Message[]> {
    const { data, error } = await getSupabase()
      .from('messages')
      .select(COLUMNS)
      .eq('channel_id', channelId)
      .not('pinned_at', 'is', null)
      .is('deleted_at', null)
      .order('pinned_at', { ascending: false })
      .limit(25)

    if (error) throw toAppError(error)
    return ((data ?? []) as unknown as MessageRow[]).map(toMessage)
  },

  async listConversationPinned(conversationId: string): Promise<Message[]> {
    const { data, error } = await getSupabase()
      .from('messages')
      .select(COLUMNS)
      .eq('conversation_id', conversationId)
      .not('pinned_at', 'is', null)
      .is('deleted_at', null)
      .order('pinned_at', { ascending: false })
      .limit(25)

    if (error) throw toAppError(error)
    return ((data ?? []) as unknown as MessageRow[]).map(toMessage)
  },

  async listReactions(messageIds: readonly string[]): Promise<Map<string, MessageReaction[]>> {
    const byMessage = new Map<string, MessageReaction[]>()
    if (messageIds.length === 0) return byMessage

    const supabase = getSupabase()
    const { data: userData } = await supabase.auth.getUser()
    const me = userData.user?.id ?? null

    // One request for the whole page. Rows arrive already scoped: a reaction
    // on a message the caller cannot read is not in the response.
    const { data, error } = await supabase
      .from('message_reactions')
      .select('message_id, emoji, user_id')
      .in('message_id', [...messageIds])

    if (error) throw toAppError(error)

    for (const row of data ?? []) {
      const list = byMessage.get(row.message_id) ?? []
      const existing = list.find((r) => r.emoji === row.emoji)
      if (existing) {
        existing.count += 1
        existing.mine = existing.mine || row.user_id === me
      } else {
        list.push({ emoji: row.emoji, count: 1, mine: row.user_id === me })
      }
      byMessage.set(row.message_id, list)
    }

    return byMessage
  },

  async listMentions(messageIds: readonly string[]): Promise<Map<string, MessageMention[]>> {
    const byMessage = new Map<string, MessageMention[]>()
    if (messageIds.length === 0) return byMessage

    // Rows arrive already scoped: a mention on a message the caller cannot
    // read is not in the response.
    const { data, error } = await getSupabase()
      .from('message_mentions')
      .select('message_id, user_id, handle')
      .in('message_id', [...messageIds])

    if (error) throw toAppError(error)

    for (const row of data ?? []) {
      const list = byMessage.get(row.message_id) ?? []
      list.push({ userId: row.user_id, handle: row.handle })
      byMessage.set(row.message_id, list)
    }

    return byMessage
  },

  async addReaction(messageId: string, emoji: string): Promise<void> {
    const supabase = getSupabase()
    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) throw new AppError('auth', 'Your session has expired. Please sign in again.')

    // user_id is set from the session and the policy checks it again against
    // auth.uid() — reacting as somebody else is refused twice.
    const { error } = await supabase
      .from('message_reactions')
      .insert({ message_id: messageId, user_id: userId, emoji })

    if (error) throw toAppError(error)
  },

  async removeReaction(messageId: string, emoji: string): Promise<void> {
    const supabase = getSupabase()
    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) throw new AppError('auth', 'Your session has expired. Please sign in again.')

    const { error } = await supabase
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji)

    if (error) throw toAppError(error)
  },

  /**
   * Full text search.
   *
   * The routine is SECURITY INVOKER, so the messages policy has already
   * decided what may come back before this code sees anything. Channel names
   * are resolved separately because the routine returns ids, and the channels
   * the caller can name are the same ones it could search.
   */
  async search(input: MessageSearchInput): Promise<MessageSearchResult[]> {
    const supabase = getSupabase()

    const { data, error } = await supabase.rpc('search_messages', {
      p_query: input.query,
      p_channel_id: input.channelId,
      p_conversation_id: input.conversationId ?? null,
      p_before: input.before ?? null,
    })
    if (error) throw toAppError(error)

    const rows = data ?? []
    if (rows.length === 0) return []

    const [{ data: channels }, { data: profiles }] = await Promise.all([
      supabase.from('channels').select('id, key, name'),
      supabase
        .from('profiles')
        .select('id, display_name, full_name, email')
        .in('id', [
          ...new Set(rows.map((r) => r.author_id).filter((id): id is string => Boolean(id))),
        ]),
    ])

    const channelById = new Map((channels ?? []).map((c) => [c.id, c]))
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

    return rows.map((row) => {
      const channel = row.channel_id ? channelById.get(row.channel_id) : undefined
      const author = row.author_id ? profileById.get(row.author_id) : undefined
      return {
        id: row.id,
        channelId: row.channel_id,
        conversationId: row.conversation_id,
        // A direct message has no channel to name; the conversation it came
        // from is the one the caller asked about.
        channelName: row.conversation_id ? '' : (channel?.name ?? 'Unknown channel'),
        channelKey: channel?.key ?? '',
        authorName: author?.display_name ?? author?.full_name ?? author?.email ?? 'Removed member',
        body: row.body,
        createdAt: row.created_at,
        parentMessageId: row.parent_message_id,
      }
    })
  },
}

function impl(): MessageService {
  return isDemoSessionActive() ? demoMessageService : supabaseMessageService
}

export const messageService: MessageService = {
  list: (channelId, before) => impl().list(channelId, before),
  getById: (messageId) => impl().getById(messageId),
  send: (channelId, body, parentMessageId) => impl().send(channelId, body, parentMessageId),
  listReplies: (rootMessageId) => impl().listReplies(rootMessageId),
  listReplyContexts: (messageIds) => impl().listReplyContexts(messageIds),
  edit: (messageId, body) => impl().edit(messageId, body),
  remove: (messageId, reason) => impl().remove(messageId, reason),
  setPinned: (messageId, pinned) => impl().setPinned(messageId, pinned),
  listConversation: (conversationId, before) => impl().listConversation(conversationId, before),
  sendToConversation: (conversationId, body, parentMessageId) =>
    impl().sendToConversation(conversationId, body, parentMessageId),
  listConversationPinned: (conversationId) => impl().listConversationPinned(conversationId),
  listPinned: (channelId) => impl().listPinned(channelId),
  listReactions: (messageIds) => impl().listReactions(messageIds),
  listMentions: (messageIds) => impl().listMentions(messageIds),
  addReaction: (messageId, emoji) => impl().addReaction(messageId, emoji),
  removeReaction: (messageId, emoji) => impl().removeReaction(messageId, emoji),
  search: (input) => impl().search(input),
}
