import { useSyncExternalStore } from 'react'
import { voiceActivity, type VoiceActivityEvent } from '@/services/voice-activity'

/**
 * The call's comings and goings, as React sees it.
 *
 * The log lives outside React for the same reason the session does: it is fed
 * by LiveKit events that arrive whether or not a panel happens to be mounted.
 */
export function useVoiceActivity(): readonly VoiceActivityEvent[] {
  return useSyncExternalStore(voiceActivity.subscribe, voiceActivity.getSnapshot)
}
