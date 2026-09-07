/**
 * Two short chimes, synthesised.
 *
 * Somebody arriving in a room you are already in is worth a sound: you are
 * usually looking at something else when it happens, which is the whole point
 * of a voice channel. It is not worth a network request, a binary asset or a
 * decoder — two sine tones and an envelope are the entire sound, so they are
 * built here at the moment they are played.
 *
 * Everything about this is deliberately defensive. A browser with no Web Audio
 * at all, a tab the autoplay policy has not unlocked, a context that refuses to
 * resume: each of those is silence, never an error. Nothing in a call should
 * break because a notification could not be played.
 *
 * It touches nothing LiveKit owns. The room's audio is `<audio>` elements fed
 * by the SDK and the microphone is a capture track; this is a context of its
 * own with a gain node in it, and the two never meet.
 */

export type VoiceCue = 'join' | 'leave'

/** Two notes, the time between them, and how loud the pair is. */
interface Chime {
  notes: readonly [number, number]
  /** Seconds between the two notes starting. */
  gap: number
  /** Peak gain. Well under a tenth: this sits under a conversation. */
  peak: number
}

/**
 * Ascending to arrive, descending to go, and the second one quieter.
 *
 * D5→A5 and E5→A4: a fifth either way, which reads as a signal rather than as
 * a tune. Both pairs are over inside a fifth of a second.
 */
const CHIMES: Record<VoiceCue, Chime> = {
  join: { notes: [587.33, 880], gap: 0.07, peak: 0.055 },
  leave: { notes: [659.25, 440], gap: 0.07, peak: 0.04 },
}

/** How long one note lasts, envelope included. */
const NOTE_SECONDS = 0.12

/**
 * One context for the life of the tab.
 *
 * A context per event would be a hardware audio graph per event, which
 * browsers rate-limit and eventually refuse. `null` means "not built yet";
 * `false` means "cannot be built", which is checked once and never retried.
 */
let context: AudioContext | null | false = null

type AudioContextConstructor = new () => AudioContext

function constructorFor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor
    webkitAudioContext?: AudioContextConstructor
  }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

/**
 * The context, built on first use.
 *
 * First use is always after a click — you joined a call — so the autoplay
 * policy has been satisfied by the time anything asks for one. A context built
 * before that would start suspended and stay that way.
 */
function audio(): AudioContext | null {
  if (context === false) return null
  if (context) return context

  const Ctor = constructorFor()
  if (!Ctor) {
    context = false
    return null
  }

  try {
    context = new Ctor()
    return context
  } catch {
    context = false
    return null
  }
}

/**
 * Play one of the two cues.
 *
 * Returns whether a sound was actually started, which is what makes this
 * testable without listening to it. Callers ignore it.
 */
export function playVoiceCue(cue: VoiceCue): boolean {
  const ctx = audio()
  if (!ctx) return false

  try {
    // A tab that was backgrounded when the context was built can have it
    // suspended. Asking is free; being refused is silence.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)

    const chime = CHIMES[cue]
    const start = ctx.currentTime

    chime.notes.forEach((frequency, index) => {
      const at = start + index * chime.gap
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()

      // A sine has no harmonics to rattle against somebody's voice.
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, at)

      // 8ms in, then down: an instant attack clicks, and a long tail turns a
      // notification into a chord.
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(chime.peak, at + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_SECONDS)

      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(at)
      oscillator.stop(at + NOTE_SECONDS + 0.02)
    })

    return true
  } catch {
    // A context that has been closed, a node the browser would not build:
    // either way this is a notification, and a notification is never worth an
    // exception in a call.
    return false
  }
}

/** Test seam. Drops the context so the next cue builds a fresh one. */
export function resetVoiceSoundsForTest(): void {
  const open = context
  if (open !== null && open !== false) void open.close().catch(() => undefined)
  context = null
}
