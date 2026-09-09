import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/query-keys'
import { isDemoSessionActive } from '@/lib/demo-mode'

/**
 * The calendar, kept current while somebody is looking at it.
 *
 * One topic for the organization — `calendar:<uuid>`, the shape `org:<uuid>`
 * already uses — carrying Postgres Changes on `calendar_events` and nothing
 * else. No broadcast, no presence, so the topic is not opened `private` and
 * needs no policy on `realtime.messages`: row delivery is scoped by the
 * `calendar.view` policy on the table itself, per subscriber.
 *
 * That last sentence was verified rather than assumed, by
 * `scripts/verify-calendar-realtime.mjs` against the live project:
 *
 *   · a member receives INSERT and UPDATE as the full thirteen-column row
 *   · an anonymous subscriber receives an empty envelope carrying
 *     `errors: ["Error 401: Unauthorized"]` — never a title, location or
 *     description
 *   · a DELETE arrives as a bare id, to everybody who may read the table,
 *     so a deleted event's body cannot leak either
 *
 * The subscription is deliberately unfiltered. A `filter` can only match on
 * columns the payload carries, and a deletion carries one — the same reason
 * the `message_reactions` subscriptions in chat are unfiltered. RLS is what
 * scopes delivery; the organization check below is a second, cheaper one for
 * the rows that do carry an organization.
 *
 * What arrives is treated as news, not as data. Nothing here places an event
 * on the grid: an edit can move an event out of the window on screen, into it,
 * across a month boundary, or from timed to all-day, and every one of those is
 * a question about range membership that the existing query already answers
 * correctly. So a change invalidates the organization's calendar family and
 * the ranges that are mounted refetch themselves. One small refetch, and no
 * second copy of the placement rules to keep in step.
 */
export function useCalendarRealtime(organizationId: string | undefined): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    // Demo mode has no server to talk to; its calendar is local and synchronous.
    if (!organizationId || isDemoSessionActive()) return

    const supabase = getSupabase()
    const topic = `calendar:${organizationId}`

    /**
     * Ask the calendar again.
     *
     * Invalidation rather than a cache write, and idempotent either way: the
     * author's own mutation already invalidates, and this arriving a moment
     * later costs at most one more refetch. Two identical events cannot
     * produce two copies of anything, which manual insertion could.
     */
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all(organizationId) })
    }

    // StrictMode runs an effect twice in development and `removeChannel` is
    // asynchronous, so the second run can find the first channel still
    // registered under this topic — and Supabase hands back the same object,
    // where a second `.on()` after `subscribe()` throws. Clearing it first
    // makes one subscription per organization true rather than hoped for.
    for (const existing of supabase.getChannels()) {
      if (existing.topic === topic || existing.topic === `realtime:${topic}`) {
        void supabase.removeChannel(existing)
      }
    }

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calendar_events' },
        (payload) => {
          const fresh = payload.new as { organization_id?: string } | null
          const stale = payload.old as { organization_id?: string } | null
          const owner = fresh?.organization_id ?? stale?.organization_id

          // Another organization's diary is none of this calendar's business.
          // A deletion and an unauthorized envelope both arrive without one, and
          // are treated as news: the refetch that follows is scoped by RLS, so
          // the worst it can do is return exactly what is already on screen.
          if (typeof owner === 'string' && owner !== organizationId) return
          refresh()
        },
      )

    channel.subscribe((status) => {
      // SUBSCRIBED is the join being acknowledged, not the WAL stream being
      // wired up, and an event published in that gap is simply lost. One
      // refetch on connect closes it — and is also how a reconnection recovers
      // whatever changed while the socket was down, without trying to
      // reconstruct the events it missed.
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) refresh()
      // Every other status is left alone on purpose. The queries are the
      // source of truth and keep working; a transient reconnect is not
      // something to put on the screen.
    })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [organizationId, queryClient])
}
