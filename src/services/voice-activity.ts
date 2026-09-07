import { useVoiceStore } from '@/stores/voice.store'
import { playVoiceCue } from './voice-sounds'

/**
 * Who came and went, for as long as the call lasts.
 *
 * LiveKit is the only source of this. The room tells us when a participant
 * connects and disconnects, and this keeps the last few of those so the
 * channel panel can answer "did I miss somebody arriving" without asking a
 * server anything. Nothing is written to Postgres, nothing is broadcast, and
 * nothing here survives the room it belongs to.
 *
 * It is deliberately free of `livekit-client`: the panel imports this to read
 * the log, and only `voice.service` — which already owns the Room — imports it
 * to write one. Same reasoning as `voice-session`.
 *
 * The presence map is what makes the log honest. LiveKit can fire the same
 * lifecycle callback twice, and a reconnect re-announces everybody who is
 * still in the room; an arrival for somebody already here, or a departure for
 * somebody already gone, is not an event and is dropped.
 */

export type VoiceActivityKind = 'join' | 'leave'

export interface VoiceActivityEvent {
  /** Stable for a list key: one participant cannot do the same thing twice at
   *  the same millisecond. */
  id: string
  kind: VoiceActivityKind
  /**
   * The channel whose room this happened in.
   *
   * Carried on the event rather than read from the live session: leaving ends
   * the session, and the record of having left has to outlive it or the one
   * event nobody could otherwise see would vanish as it was written.
   */
  channelId: string | null
  identity: string
  name: string
  isLocal: boolean
  /** ISO 8601, so the row can render a clock without keeping a Date around. */
  at: string
}

/** Enough to answer "who has been in and out", and not a transcript. */
export const MAX_VOICE_ACTIVITY = 20

let events: readonly VoiceActivityEvent[] = []
/** The room these events belong to. */
let channelId: string | null = null
/** identity → in the room, as far as the log is concerned. */
const present = new Set<string>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export const voiceActivity = {
  getSnapshot: (): readonly VoiceActivityEvent[] => events,

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/**
 * Start a room's log.
 *
 * Called when a room opens, with whoever was already in it. Those people did
 * not just arrive — you did — so they are marked present without an event,
 * which is also what lets their eventual departure be one.
 */
export function beginVoiceActivity(
  room: string | null,
  alreadyHere: readonly { identity: string }[] = [],
): void {
  events = []
  channelId = room
  present.clear()
  for (const participant of alreadyHere) present.add(participant.identity)
  notify()
}

/**
 * Record an arrival or a departure.
 *
 * Returns whether it was recorded, which is how the duplicate rule is
 * observed from a test. A sound is played for remote participants only: you
 * know perfectly well that you joined, and a chime for your own click is
 * noise.
 */
export function recordVoiceActivity(input: {
  kind: VoiceActivityKind
  identity: string
  name: string
  isLocal: boolean
  /** Injectable so a test does not depend on the clock. */
  at?: Date
}): boolean {
  const here = present.has(input.identity)
  // The whole of the duplicate rule: an event that does not change presence
  // did not happen.
  if (input.kind === 'join' && here) return false
  if (input.kind === 'leave' && !here) return false

  if (input.kind === 'join') present.add(input.identity)
  else present.delete(input.identity)

  const at = input.at ?? new Date()
  const event: VoiceActivityEvent = {
    id: `${input.identity}:${input.kind}:${String(at.getTime())}`,
    kind: input.kind,
    channelId,
    identity: input.identity,
    name: input.name,
    isLocal: input.isLocal,
    at: at.toISOString(),
  }

  // Newest first, and only ever the newest twenty.
  events = [event, ...events].slice(0, MAX_VOICE_ACTIVITY)
  notify()

  if (!input.isLocal && useVoiceStore.getState().voiceActivitySoundsEnabled) {
    playVoiceCue(input.kind)
  }

  return true
}

/** Test seam, and the reset a fresh room would do anyway. */
export function resetVoiceActivityForTest(): void {
  events = []
  channelId = null
  present.clear()
  notify()
}
