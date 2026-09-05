import { useEffect, useRef, useState } from 'react'
import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import { isDemoSessionActive } from '@/lib/demo-mode'
import type { ChannelRealtime } from './use-channel-realtime'

/**
 * One realtime topic per conversation: `dm:<conversation_id>`, private.
 *
 * The C3 Step 1 probe established that Supabase will join a private topic
 * whose name does not begin with `channel:`, and that a policy calling a
 * table-reading function works there. This is that result in production: the
 * `realtime.messages` policies call `can_join_conversation_topic`, which
 * unwraps the id and defers to `can_in_conversation`. Somebody who is not in
 * the conversation cannot join the topic, and that is enforced by the server
 * rather than by this file.
 *
 * Message rows are filtered again by the RLS on `public.messages`, so a
 * subscriber only ever receives rows it could have selected anyway — two
 * independent reasons a stranger receives nothing.
 *
 * Deliberately a second hook rather than a parameter on the channel one. What
 * differs is the topic name and the filter column, and both of those are the
 * subscription itself; sharing the body would mean a conditional in every line
 * that matters.
 */

const TYPING_TTL_MS = 3000
const TYPING_THROTTLE_MS = 1500
const TYPING_IDLE_MS = 2000

interface TypingPayload {
  userId: string
  typing: boolean
}

export function useConversationRealtime(
  conversationId: string | null,
  currentUserId: string | null,
  onMessageChange: () => void,
  onReactionChange: () => void = () => undefined,
): ChannelRealtime {
  const [typing, setTyping] = useState<Record<string, number>>({})
  const [connected, setConnected] = useState(false)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastSentRef = useRef(0)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onMessageChange)
  onChangeRef.current = onMessageChange
  const onReactionRef = useRef(onReactionChange)
  onReactionRef.current = onReactionChange

  useEffect(() => {
    if (!conversationId || isDemoSessionActive()) {
      setConnected(false)
      return
    }

    const supabase = getSupabase()
    let cancelled = false

    const channel = supabase
      .channel(`dm:${conversationId}`, {
        config: { private: true, broadcast: { self: false } },
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => onChangeRef.current(),
      )
      // Unfiltered for the same reason the channel hook leaves it unfiltered:
      // a DELETE payload carries only the replica identity, which Supabase
      // projects down to the primary key, so a filter would silently never
      // match a removed reaction. RLS scopes delivery either way.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () =>
        onReactionRef.current(),
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const data = payload as Partial<TypingPayload>
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
      // The join being acknowledged is not the same as the WAL stream being
      // wired up; one refetch on connect closes that gap, and is also how a
      // reconnection recovers whatever was missed while the socket was down.
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
  }, [conversationId, currentUserId])

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
