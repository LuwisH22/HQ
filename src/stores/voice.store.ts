import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Voice preferences, which belong to this browser and nowhere else.
 *
 * How loud somebody else is to you, whether you hold a key to talk, and which
 * processing your microphone runs through are all facts about your headset and
 * your room. None of them is true for anybody else, none of them is worth a
 * migration, and none of them should survive being asked of a server — so they
 * sit beside the other local preferences, in the same persisted store pattern
 * `lfg-hq-ui` established.
 *
 * Nothing here is trusted for authorization. Whether a microphone may be
 * published at all is decided in Postgres and enforced by the token; these are
 * the settings of somebody who has already been told yes.
 */

export type InputMode = 'voice-activity' | 'push-to-talk'

/**
 * The browser's own limit.
 *
 * LiveKit's `setVolume` writes `HTMLMediaElement.volume`, which is 0–1 and
 * nothing else. Amplifying past unity would mean routing playback through a
 * Web Audio graph — a different playback path, with its own autoplay
 * behaviour — which is more than a volume slider should decide.
 */
export const MAX_VOLUME = 1

export interface AudioProcessing {
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

interface VoiceState {
  inputMode: InputMode
  /** A KeyboardEvent.code, so it is a key on the board and not a character. */
  pushToTalkKey: string
  audioProcessing: AudioProcessing
  /** Per participant identity, 0–1. Absent means unchanged, which is 1. */
  volumes: Record<string, number>
  /**
   * Whether somebody arriving or leaving makes a sound.
   *
   * On, because the point of a voice channel is that you are looking at
   * something else while you are in one. Off is one switch away, and it is a
   * fact about this browser like everything else here.
   */
  voiceActivitySoundsEnabled: boolean

  setInputMode: (mode: InputMode) => void
  setPushToTalkKey: (code: string) => void
  setAudioProcessing: (next: Partial<AudioProcessing>) => void
  setVolume: (identity: string, volume: number) => void
  resetVolume: (identity: string) => void
  setVoiceActivitySounds: (enabled: boolean) => void
}

/** Whatever arrives, what is stored is a number between silence and unity. */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return MAX_VOLUME
  return Math.min(MAX_VOLUME, Math.max(0, value))
}

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set) => ({
      // Off by default, as it should be: a microphone that only works while a
      // key is held is a surprise unless it was asked for.
      inputMode: 'voice-activity',
      pushToTalkKey: 'Space',
      audioProcessing: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      volumes: {},
      voiceActivitySoundsEnabled: true,

      setInputMode: (inputMode) => set({ inputMode }),
      setPushToTalkKey: (pushToTalkKey) => set({ pushToTalkKey }),
      setAudioProcessing: (next) =>
        set((current) => ({ audioProcessing: { ...current.audioProcessing, ...next } })),
      setVolume: (identity, volume) =>
        set((current) => ({ volumes: { ...current.volumes, [identity]: clampVolume(volume) } })),
      resetVolume: (identity) =>
        set((current) => {
          // Removed rather than set back to 1, so "never touched" and "put
          // back" are the same state and the store does not grow a row for
          // everybody who was ever in a room.
          const { [identity]: _gone, ...rest } = current.volumes
          return { volumes: rest }
        }),
      setVoiceActivitySounds: (voiceActivitySoundsEnabled) => set({ voiceActivitySoundsEnabled }),
    }),
    {
      name: 'lfg-hq-voice',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
)
