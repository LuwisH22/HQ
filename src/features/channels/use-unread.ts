import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import { channelService } from '@/services/channel.service'
import { getSupabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/query-keys'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'

/**
 * Unread counts per channel, and the socket that keeps them current.
 *
 * The sidebar has to learn about messages in channels nobody is looking at,
 * which the per-channel topic cannot tell it. So one organization-wide topic
 * carries the news: `org:<uuid>`.
 *
 * Deliberately not a *private* topic. It carries Postgres Changes and nothing
 * else — no broadcast, no presence — and Postgres Changes filters row delivery
 * by RLS per subscriber, which is the same mechanism C1 relies on for
 * messages. A member is woken only by a message they could have read and by a
 * notification addressed to them, whoever else can join the topic by name.
 *
 * The counts themselves come from `unread_counts()`, which is SECURITY
 * INVOKER — a channel the caller cannot see contributes no row, so there is
 * nothing here that could leak one.
 */
export function useUnreadCounts(): Map<string, number> {
  const { organization } = useWorkspace()
  const organizationId = organization?.id
  const canView = usePermission('channels.view')

  const query = useQuery({
    queryKey: queryKeys.reads.unread(organizationId ?? 'none'),
    queryFn: () => channelService.unreadCounts(),
    enabled: Boolean(organizationId) && canView,
  })

  return new Map((query.data ?? []).map((row) => [row.channelId, row.unread]))
}

/**
 * The socket, subscribed once for the whole application.
 *
 * Deliberately not part of the hook above. The channel list renders twice on a
 * phone — once in the sidebar that CSS hides and once in the drawer — and
 * Supabase hands back the same channel object for the same topic, so a second
 * `.on()` after the first `subscribe()` throws outright. Mounting this at the
 * shell makes "once" a property of where it lives rather than a thing every
 * caller has to remember.
 */
export function useUnreadRealtime(): void {
  const { organization } = useWorkspace()
  const organizationId = organization?.id
  const queryClient = useQueryClient()

  useEffect(() => {
    // Demo mode has no server to talk to; the store is local and synchronous.
    if (!organizationId || isDemoSessionActive()) return

    const supabase = getSupabase()
    const channel = supabase
      .channel(`org:${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.reads.unread(organizationId) })

        // A direct message reaches this topic too — Postgres Changes filters
        // delivery by RLS, so only the ones the caller could read arrive. That
        // makes this the reliable delivery path for a conversation, and leaves
        // the dm: topic responsible only for typing.
        const row = (payload.new ?? payload.old) as { conversation_id?: string | null } | null
        const conversationId = row?.conversation_id
        if (typeof conversationId !== 'string') return

        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.all(organizationId),
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.messages.list(conversationId),
        })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.all(organizationId),
        })
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.unreadCount(organizationId),
        })
      })

    channel.subscribe((status) => {
      // SUBSCRIBED means the join was acknowledged, not that the server has
      // finished wiring the subscription to the WAL stream. Refetching once on
      // connect closes that gap without guessing at a delay.
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.reads.unread(organizationId) })
      }
    })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [organizationId, queryClient])
}
