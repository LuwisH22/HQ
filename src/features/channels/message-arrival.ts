import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Message } from '@/services/message.service'

/**
 * Which messages have just turned up, and whose they are.
 *
 * THIS CHANGES NOTHING ABOUT HOW A MESSAGE ARRIVES. The realtime hooks
 * invalidate a query and the list refetches; that is the whole flow and it is
 * untouched. This only watches the array it is handed and notices what was not
 * in it last time, which is the same information the hooks have and the only
 * information an entrance needs: a new id, and whether its author is you.
 *
 * Everything on screen at the first render is already settled. Opening a
 * channel must not animate fifty messages, and a refetch that returns the same
 * fifty is not an arrival either — so the first array seeds the set of things
 * already seen and reports nothing.
 *
 * A message stays marked only long enough to animate. The row clears its own
 * mark on `animationend`; the timer below is the floor under that for a tab
 * that was hidden while the animation would have run, so a settled message can
 * never keep a transform.
 */

export type Arrival = 'own' | 'incoming'

/** The entrance plus the arrival tint, with room for a slow frame. */
const ARRIVAL_TTL_MS = 1200

export interface Arrivals {
  /** How this message got here, or undefined if it was already settled. */
  arrivalOf: (messageId: string) => Arrival | undefined
  /** Called by a row when its entrance finishes. */
  settle: (messageId: string) => void
}

export function useMessageArrivals(
  messages: readonly Message[],
  currentUserId: string | null,
): Arrivals {
  const seen = useRef<Set<string> | null>(null)
  const [arrivals, setArrivals] = useState<ReadonlyMap<string, Arrival>>(new Map())

  // A layout effect, for two reasons. It runs before the browser paints, so a
  // new message is painted with its entrance class already on it rather than
  // appearing once and then animating — which reads as a flicker. And it runs
  // once per commit, so StrictMode's double render cannot advance the set of
  // seen ids twice and swallow the arrival it was meant to report.
  useLayoutEffect(() => {
    if (seen.current === null) {
      // First paint: everything here is history.
      seen.current = new Set(messages.map((message) => message.id))
      return
    }

    const fresh: [string, Arrival][] = []
    for (const message of messages) {
      if (seen.current.has(message.id)) continue
      seen.current.add(message.id)
      fresh.push([message.id, message.authorId === currentUserId ? 'own' : 'incoming'])
    }
    if (fresh.length === 0) return

    setArrivals((current) => {
      const next = new Map(current)
      for (const [id, kind] of fresh) next.set(id, kind)
      return next
    })
  }, [messages, currentUserId])

  // The floor under `animationend`. A background tab fires no animation
  // events, so a mark left behind would outlive its animation.
  useLayoutEffect(() => {
    if (arrivals.size === 0) return
    const timer = setTimeout(() => setArrivals(new Map()), ARRIVAL_TTL_MS)
    return () => clearTimeout(timer)
  }, [arrivals])

  const settle = useCallback((messageId: string) => {
    setArrivals((current) => {
      if (!current.has(messageId)) return current
      const next = new Map(current)
      next.delete(messageId)
      return next
    })
  }, [])

  return { arrivalOf: (messageId) => arrivals.get(messageId), settle }
}
