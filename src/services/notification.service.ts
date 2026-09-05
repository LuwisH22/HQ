import { getSupabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { demoNotificationService } from '@/services/demo'
import { firstOf } from './postgrest'
import type { Notification, NotificationService } from './service-contracts'

export type { Notification } from './service-contracts'

/**
 * Notifications addressed to you.
 *
 * There is no create method and there never will be one from here: the table
 * has no INSERT policy at all, and rows are written only by SECURITY DEFINER
 * code in Postgres. A client cannot manufacture a notification for somebody
 * else, or thousands for itself.
 *
 * Reads are scoped by `recipient_id = auth.uid()` in the policy, so this file
 * does no filtering — there is nothing here to get wrong.
 */

const COLUMNS = `id, type, entity_type, entity_id, summary, metadata, read_at, created_at,
   actor:profiles!notifications_actor_id_fkey ( id, display_name, full_name, email )`

interface NotificationRow {
  id: number
  type: string
  entity_type: string
  entity_id: string
  summary: string
  metadata: unknown
  read_at: string | null
  created_at: string
  actor: unknown
}

function toNotification(row: NotificationRow): Notification {
  const actor = firstOf(row.actor) as {
    display_name: string | null
    full_name: string | null
    email: string
  } | null

  return {
    id: row.id,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorName: actor ? (actor.display_name ?? actor.full_name ?? actor.email) : null,
    summary: row.summary,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

export const supabaseNotificationService: NotificationService = {
  async list(_organizationId: string, limit = 30): Promise<Notification[]> {
    const { data, error } = await getSupabase()
      .from('notifications')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw toAppError(error)
    return ((data ?? []) as unknown as NotificationRow[]).map(toNotification)
  },

  async unreadCount(): Promise<number> {
    const { count, error } = await getSupabase()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)

    if (error) throw toAppError(error)
    return count ?? 0
  },

  async markRead(ids?: readonly number[]): Promise<void> {
    // The routine is SECURITY INVOKER, so the policy decides whose. Passing
    // null marks every unread one read.
    const { error } = await getSupabase().rpc('mark_notifications_read', {
      p_ids: ids ? [...ids] : null,
    })
    if (error) throw toAppError(error)
  },
}

function impl(): NotificationService {
  return isDemoSessionActive() ? demoNotificationService : supabaseNotificationService
}

export const notificationService: NotificationService = {
  list: (organizationId, limit) => impl().list(organizationId, limit),
  unreadCount: (organizationId) => impl().unreadCount(organizationId),
  markRead: (ids) => impl().markRead(ids),
}
