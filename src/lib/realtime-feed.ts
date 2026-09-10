import { useEffect, useRef } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import { isDemoSessionActive } from '@/lib/demo-mode'

/**
 * One way of listening to the database, for every feature that does.
 *
 * The calendar established this in 5.3C and projects reused it in 6.4, both
 * against the live project rather than on faith: one topic, Postgres Changes,
 * no broadcast and no presence — so nothing is opened `private`, no policy on
 * `realtime.messages` is needed, and delivery is scoped by the same `select`
 * policies the queries obey. Two facts were measured then and hold for any
 * table that joins the publication:
 *
 *   · a payload carries only the columns the subscriber may select, so a
 *     column the grant withholds cannot travel however the row is shaped
 *   · a delete arrives as a bare primary key, to everybody who may read the
 *     table, which is why replica identity stays default
 *
 * Subscriptions are deliberately unfiltered. A server-side `filter` can only
 * match on columns the payload carries, and a deletion carries one — so scope
 * is checked in the handler, where a row that cannot be placed is treated as
 * news rather than discarded.
 *
 * This file is the part that is the same everywhere. What each feature keeps
 * to itself is which tables it cares about and which query families a change
 * makes stale, which is the part worth reading twice.
 */

/** A row as Postgres Changes delivers it: some columns, or for a delete, an id. */
export type ChangedRow = Record<string, unknown> | null | undefined

export interface Change {
  table: string
  new: ChangedRow
  old: ChangedRow
}

/** A column from whichever half of the payload carries it. */
export function fieldOf(change: Change, name: string): string | undefined {
  const fresh = change.new?.[name]
  if (typeof fresh === 'string') return fresh
  const stale = change.old?.[name]
  return typeof stale === 'string' ? stale : undefined
}

/**
 * Whether a row belongs to somewhere else.
 *
 * Deliberately one-sided. A delete arrives as a primary key and nothing more,
 * so `undefined` means "cannot tell", and cannot-tell is treated as ours. The
 * refetch that follows is scoped by RLS, so guessing wrong costs one read of
 * rows the reader may already see; guessing the other way would leave the
 * screen wrong.
 */
export function elsewhere(value: string | undefined, mine: string): boolean {
  return typeof value === 'string' && value !== mine
}

/**
 * The socket half: join a topic, hear about some tables, leave.
 *
 * The handler is read from a ref rather than closed over, so a component that
 * re-renders — which a board does constantly while a card is being dragged —
 * does not tear down and rebuild its subscription.
 */
export function useChangeFeed(
  topic: string,
  tables: readonly string[],
  enabled: boolean,
  onChange: (change: Change) => void,
  onConnect: () => void,
): void {
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const connectRef = useRef(onConnect)
  connectRef.current = onConnect

  const signature = tables.join(',')

  useEffect(() => {
    if (!enabled || isDemoSessionActive()) return

    const supabase = getSupabase()

    // StrictMode runs an effect twice in development and `removeChannel` is
    // asynchronous, so the second run can find the first channel still
    // registered under this topic — and Supabase hands back the same object,
    // where a second `.on()` after `subscribe()` throws. Clearing it first
    // makes one subscription per topic true rather than hoped for. It is also
    // what stops a stale team's subscription surviving navigation to another.
    for (const existing of supabase.getChannels()) {
      if (existing.topic === topic || existing.topic === `realtime:${topic}`) {
        void supabase.removeChannel(existing)
      }
    }

    let channel = supabase.channel(topic)
    for (const table of signature.split(',')) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          changeRef.current({ table, new: payload.new, old: payload.old })
        },
      )
    }

    // The moment the stream is actually running.
    //
    // SUBSCRIBED is the join being acknowledged; the replication connection
    // behind it is established afterwards, and the server says so with a
    // `system` message of its own. Everything written in between is published
    // to nobody on this channel.
    channel = channel.on('system', {}, (payload: { extension?: string }) => {
      if (payload.extension === 'postgres_changes') connectRef.current()
    })

    channel.subscribe((status) => {
      // And once more on the join itself, because that one is guaranteed. Two
      // small reads on connect is the price of not depending on a message that
      // may never come if replication cannot be established at all — in which
      // case being current once is better than being current never.
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) connectRef.current()
      // Every other status is left alone on purpose. The queries are the
      // source of truth and keep working; a transient reconnect is not
      // something to put on the screen.
    })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [topic, signature, enabled])
}

/** Mark a set of families stale. Never a cache write, ever: see any router. */
export function invalidateKeys(client: QueryClient, keys: readonly (readonly unknown[])[]): void {
  for (const key of keys) {
    void client.invalidateQueries({ queryKey: key })
  }
}
