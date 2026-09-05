import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { demoConversationService } from '@/services/demo'
import { firstOf } from './postgrest'
import type { Conversation, ConversationService, MentionCandidate } from './service-contracts'

export type { Conversation } from './service-contracts'

/**
 * Direct conversations.
 *
 * The authorization story is short, and that is the point of it: a
 * conversation is visible to the people in it. Not to the organization owner,
 * not to a role, not to anybody holding a channel permission. Every read below
 * is scoped by RLS through `can_in_conversation`, so a conversation the caller
 * is not in is absent from the response rather than filtered out here —
 * guessing an id gains nothing, and neither does holding every permission in
 * the organization.
 *
 * Nothing here creates or edits a membership row. `start_direct_message` is
 * the only way a conversation or a membership appears, and neither table has a
 * client write policy at all.
 */

interface ProfileRow {
  id: string
  display_name: string | null
  full_name: string | null
  email: string
  avatar_url: string | null
}

function nameOf(profile: ProfileRow | undefined): string {
  return profile?.display_name ?? profile?.full_name ?? profile?.email ?? 'Removed member'
}

export const supabaseConversationService: ConversationService = {
  async list(): Promise<Conversation[]> {
    const supabase = getSupabase()

    const { data: userData } = await supabase.auth.getUser()
    const me = userData.user?.id ?? null

    // Three reads rather than one join: the membership rows are what carry the
    // other person's id, and the counts come from a function that has to run
    // as the caller to stay isolated.
    const [{ data: rows, error }, { data: counts, error: countError }] = await Promise.all([
      supabase.from('conversations').select(
        `id, kind,
           members:conversation_members ( user_id )`,
      ),
      supabase.rpc('conversation_unread_counts'),
    ])

    if (error) throw toAppError(error)
    if (countError) throw toAppError(countError)

    const conversations = rows ?? []
    if (conversations.length === 0) return []

    const otherIds = new Set<string>()
    for (const row of conversations) {
      for (const member of (row.members ?? []) as { user_id: string }[]) {
        if (member.user_id !== me) otherIds.add(member.user_id)
      }
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, full_name, email, avatar_url')
      .in('id', [...otherIds])

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))
    const countById = new Map((counts ?? []).map((c) => [c.conversation_id, c]))

    return conversations
      .map((row) => {
        const memberIds = ((row.members ?? []) as { user_id: string }[]).map((m) => m.user_id)
        const otherUserId = memberIds.find((id) => id !== me) ?? null
        const profile = otherUserId ? profileById.get(otherUserId) : undefined
        const count = countById.get(row.id)

        return {
          id: row.id,
          kind: row.kind,
          memberIds,
          otherUserId,
          otherName: nameOf(profile),
          otherAvatarUrl: profile?.avatar_url ?? null,
          unread: count?.unread ?? 0,
          lastMessageAt: count?.last_message_at ?? null,
          lastReadAt: count?.last_read_at ?? null,
        }
      })
      .sort(byRecency)
  },

  async getById(conversationId: string): Promise<Conversation | null> {
    // Deliberately the list: a conversation is small in number and its
    // summary needs the same three reads either way, so there is one
    // assembly of the shape rather than two that can disagree.
    const all = await supabaseConversationService.list('')
    return all.find((c) => c.id === conversationId) ?? null
  },

  async startDirect(organizationId: string, userId: string): Promise<string> {
    const { data, error } = await getSupabase().rpc('start_direct_message', {
      p_organization_id: organizationId,
      p_user_id: userId,
    })
    if (error) throw toAppError(error)
    if (typeof data !== 'string') {
      throw new AppError('unknown', 'Could not open that conversation.')
    }
    return data
  },

  async markRead(conversationId: string): Promise<void> {
    const supabase = getSupabase()
    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) throw new AppError('auth', 'Your session has expired. Please sign in again.')

    // The marker is stamped by a trigger and only ever moves forward, so a
    // stale second device cannot undo a read the first one recorded.
    const { error } = await supabase
      .from('conversation_reads')
      .upsert({ conversation_id: conversationId, user_id: userId })

    if (error) throw toAppError(error)
  },

  async listMentionCandidates(conversationId: string): Promise<MentionCandidate[]> {
    const supabase = getSupabase()

    // The conversation's own membership, not channel_member_ids: a DM has no
    // channel and its roster is the two people in it.
    const { data: members, error } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)

    if (error) throw toAppError(error)
    const ids = (members ?? []).map((m) => m.user_id)
    if (ids.length === 0) return []

    const { data, error: rosterError } = await supabase
      .from('organization_members')
      .select(
        `user_id,
         profile:profiles!organization_members_user_id_fkey ( display_name, full_name, email, avatar_url ),
         role:roles!organization_members_role_id_fkey ( name )`,
      )
      .in('user_id', ids)

    if (rosterError) throw toAppError(rosterError)

    return (data ?? []).map((row) => {
      const profile = firstOf(row.profile)
      const role = firstOf(row.role)

      // The same rule the mention trigger resolves by.
      const handle = profile?.display_name ?? (profile?.email ?? '').split('@')[0] ?? ''

      return {
        userId: row.user_id,
        handle,
        displayName: profile?.display_name ?? profile?.full_name ?? profile?.email ?? handle,
        avatarUrl: profile?.avatar_url ?? null,
        roleName: role?.name ?? 'Member',
      }
    })
  },
}

/** Most recently spoken in first; a conversation with nothing said in it last. */
export function byRecency(a: Conversation, b: Conversation): number {
  if (a.lastMessageAt && b.lastMessageAt) return b.lastMessageAt.localeCompare(a.lastMessageAt)
  if (a.lastMessageAt) return -1
  if (b.lastMessageAt) return 1
  return a.otherName.localeCompare(b.otherName)
}

function impl(): ConversationService {
  return isDemoSessionActive() ? demoConversationService : supabaseConversationService
}

export const conversationService: ConversationService = {
  list: (organizationId) => impl().list(organizationId),
  getById: (conversationId) => impl().getById(conversationId),
  startDirect: (organizationId, userId) => impl().startDirect(organizationId, userId),
  markRead: (conversationId) => impl().markRead(conversationId),
  listMentionCandidates: (conversationId) => impl().listMentionCandidates(conversationId),
}
