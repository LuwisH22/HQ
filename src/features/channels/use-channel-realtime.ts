import { useEffect, useRef, useState } from 'react'
import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import { isDemoSessionActive } from '@/lib/demo-mode'

/**
 * One realtime topic per channel, carrying both message events and typing.
 *
 * The topic is opened `private: true`, which makes Supabase check RLS on
 * `realtime.messages` before letting the socket join or publish. Those
 * policies call `can_join_channel_topic`, which unwraps `channel:<uuid>` and
 * defers to `can_in_channel` — so joining is governed by exactly the rule that
 * governs everything else about a channel, including suspension and bans. A
 * member who cannot see the channel cannot receive typing events for it, and
 * that is enforced by the server, not by this file.
 *
 * Message rows are filtered separately by the RLS on `public.messages`, so a
 * subscriber only ever receives rows it could have selected anyway.
 *
 * Typing is deliberately ephemeral: no table, no permission, nothing stored.
 */

/** How long a typing indicator survives without a refresh. */
const TYPING_TTL_MS = 3000
/** At most one outbound typing event per this interval, however fast you type. */
const TYPING_THROTTLE_MS = 1500
/** Silence for this long ends the indicator. */
const TYPING_IDLE_MS = 2000

interface TypingPayload {
  userId: string
  typing: boolean
}

export interface ChannelRealtime {
  /** User ids currently typing, excluding you. Never contains a name. */
  typingUserIds: string[]
  /** Call on each keystroke; throttling and the stop event are handled here. */
  noteTyping: () => void
  /** Call when a message is sent, so the indicator clears at once. */
  clearTyping: () => void
  connected: boolean
}

export function useChannelRealtime(
  channelId: string | null,
  currentUserId: string | null,
  onMessageChange: () => void,
): ChannelRealtime {
  const [typing, setTyping] = useState<Record<string, number>>({})
  const [connected, setConnected] = useState(false)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastSentRef = useRef(0)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Kept in a ref so the effect does not re-subscribe on every render.
  const onChangeRef = useRef(onMessageChange)
  onChangeRef.current = onMessageChange

  useEffect(() => {
    // Demo mode has no server to talk to; the store is local and synchronous.
    if (!channelId || isDemoSessionActive()) {
      setConnected(false)
      return
    }

    const supabase = getSupabase()
    let cancelled = false

    const channel = supabase
      .channel(`channel:${channelId}`, {
        // Never echo your own typing back to you.
        config: { private: true, broadcast: { self: false } },
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        () => onChangeRef.current(),
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const data = payload as Partial<TypingPayload>
        // The payload carries an id and nothing else. Names are resolved from
        // the roster this client already holds, so a display name cannot be
        // spoofed over the wire.
        if (typeof data.userId !== 'string' || data.userId === currentUserId) return

        setTyping((current) => {
          const next = { ...current }
          if (data.typing === false) delete next[data.userId as string]
          else next[data.userId as string] = Date.now()
          return next
        })
      })

    channel.subscribe((status) => {
      if (cancelled) return
      const live = status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED
      setConnected(live)

      // SUBSCRIBED means the join was acknowledged, not that the server has
      // finished wiring the subscription to the WAL stream — an event
      // published in that gap is simply lost. Refetching once on connect
      // closes it without guessing at a delay.
      if (live) onChangeRef.current()
    })

    channelRef.current = channel

    return () => {
      cancelled = true
      channelRef.current = null
      setTyping({})
      setConnected(false)
      void supabase.removeChannel(channel)
    }
  }, [channelId, currentUserId])

  // Expire stale indicators: a client that closes its tab mid-sentence never
  // sends its stop event, so entries have to age out on their own.
  useEffect(() => {
    if (Object.keys(typing).length === 0) return
    const timer = setInterval(() => {
      const cutoff = Date.now() - TYPING_TTL_MS
      setTyping((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([, at]) => at > cutoff))
        return Object.keys(next).length === Object.keys(current).length ? current : next
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [typing])

  function emit(isTyping: boolean): void {
    const channel = channelRef.current
    if (!channel || !currentUserId) return
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: currentUserId, typing: isTyping } satisfies TypingPayload,
    })
  }

  function clearTyping(): void {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = null
    if (lastSentRef.current !== 0) {
      lastSentRef.current = 0
      emit(false)
    }
  }

  function noteTyping(): void {
    const now = Date.now()

    // Throttled: a burst of keystrokes produces at most one event per
    // interval, rather than one per character.
    if (now - lastSentRef.current > TYPING_THROTTLE_MS) {
      lastSentRef.current = now
      emit(true)
    }

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      lastSentRef.current = 0
      emit(false)
    }, TYPING_IDLE_MS)
  }

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [])

  return { typingUserIds: Object.keys(typing), noteTyping, clearTyping, connected }
}

/**
 * Discord-style phrasing for however many people are typing.
 *
 * Exported so the wording can be tested without mounting a socket.
 */
export function describeTyping(names: readonly string[]): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return `${names[0]} is typing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`
  if (names.length === 3) return `${names[0]}, ${names[1]}, and 1 other are typing`
  return `${names[0]}, ${names[1]}, and ${String(names.length - 2)} others are typing`
}
