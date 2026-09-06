import { useSyncExternalStore } from 'react'
import { voiceService, type VoiceState } from '@/services/voice.service'

/**
 * The voice session, as React sees it.
 *
 * One line, but worth having: the session lives outside React — it has to,
 * or a remount would drop a connection — and this is the single place that
 * says so. Components read a snapshot and call the service; none of them
 * touches a Room, a track or an event.
 *
 * The snapshot only changes when LiveKit says something changed, so a room
 * where nobody is talking rerenders nothing.
 */
export function useVoiceRoom(): VoiceState {
  return useSyncExternalStore(voiceService.subscribe, voiceService.getSnapshot)
}
