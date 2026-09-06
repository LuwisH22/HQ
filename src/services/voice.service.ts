import {
  ConnectionState,
  Room,
  RoomEvent,
  type RemoteParticipant,
  type RoomOptions,
} from 'livekit-client'
import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { demoVoiceService } from '@/services/demo'

/**
 * Voice, from the client's side.
 *
 * One room at a time, held here rather than in a component, for the same
 * reason a WebSocket is: a React tree that unmounts and remounts must not be
 * able to leave a microphone open or a second connection running. Everything
 * that touches LiveKit lives behind this module, so the rest of the app talks
 * about channel ids and a connection state and never about rooms or tracks.
 *
 * Authorization is not here. The client asks the `voice-token` Edge Function
 * for permission to be in a channel, and that function asks Postgres under the
 * caller's own JWT. What comes back is a token for one room, valid for ten
 * minutes, allowing a microphone and nothing else. This module cannot mint
 * one, cannot name a room, and cannot widen a grant — it can only spend what
 * it is given.
 */

export type VoiceStatus = 'idle' | 'requesting' | 'connecting' | 'connected' | 'error'

export interface VoiceState {
  status: VoiceStatus
  /** The LFG HQ channel, never a room name: the room is the server's word. */
  channelId: string | null
  /** Everyone in the room, including you, once connected. */
  participantCount: number
  micEnabled: boolean
  error: string | null
}

/** What the Edge Function hands back. Nothing here is a secret but the token. */
interface VoiceGrant {
  token: string
  url: string
  room: string
  identity: string
  channelName: string
  expiresInSeconds: number
}

const IDLE: VoiceState = {
  status: 'idle',
  channelId: null,
  participantCount: 0,
  micEnabled: false,
  error: null,
}

let state: VoiceState = IDLE
let room: Room | null = null
const listeners = new Set<() => void>()

function emit(next: Partial<VoiceState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function countParticipants(current: Room): number {
  // Everyone else, plus you.
  return current.remoteParticipants.size + 1
}

/**
 * Ask the server whether this channel is yours to be in.
 *
 * Exported because it is the whole authorization boundary and is worth being
 * able to exercise on its own — a token that comes back is proof the server
 * said yes, and no token ever comes back for a channel it said no to.
 */
export async function requestVoiceGrant(channelId: string): Promise<VoiceGrant> {
  if (isDemoSessionActive()) {
    // The authorization is real even here — the demo layer is the port of the
    // same routine, and a channel you may not be in refuses you with the same
    // sentence the server uses. What the demo has no version of is a media
    // server, and saying so is more useful than pretending either way.
    await demoVoiceService.roomFor(channelId)
    throw new AppError(
      'validation',
      'Demo mode has no voice server. Sign in to a real workspace to talk.',
    )
  }

  const invoked: { data: unknown; error: unknown } = await getSupabase().functions.invoke(
    'voice-token',
    { body: { channelId } },
  )

  if (invoked.error) {
    // The function says why in the body; supabase-js only reports the status.
    // Prefer its sentence where there is one — "You do not have access to
    // that voice channel" is worth more than "non-2xx".
    const context = (invoked.error as { context?: Response }).context
    const said = await context
      ?.clone()
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined)
    throw new AppError('server', said ?? toAppError(invoked.error).message)
  }

  const grant = invoked.data as Partial<VoiceGrant> | null
  if (typeof grant?.token !== 'string' || typeof grant.url !== 'string') {
    throw new AppError('server', 'Voice access was not granted. Please try again.')
  }
  return grant as VoiceGrant
}

function roomOptions(): RoomOptions {
  return {
    // Voice only. The camera and the screen are not merely unused here: the
    // token refuses them, and this says the same thing on the way out.
    adaptiveStream: false,
    dynacast: false,
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  }
}

export const voiceService = {
  getSnapshot: (): VoiceState => state,

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  /**
   * Join the voice channel, publishing a microphone.
   *
   * A fresh token every time. They last ten minutes, which is plenty to
   * connect with and not worth stealing; once connected, LiveKit refreshes a
   * participant's token itself, so a long call never leans on this one.
   */
  async connect(channelId: string): Promise<void> {
    if (state.status === 'connected' && state.channelId === channelId) return
    await voiceService.disconnect()

    emit({ status: 'requesting', channelId, error: null })

    let grant: VoiceGrant
    try {
      grant = await requestVoiceGrant(channelId)
    } catch (error) {
      emit({ status: 'error', error: toAppError(error).message })
      throw error
    }

    const next = new Room(roomOptions())
    room = next

    next
      .on(RoomEvent.ParticipantConnected, () => emit({ participantCount: countParticipants(next) }))
      .on(RoomEvent.ParticipantDisconnected, (_p: RemoteParticipant) =>
        emit({ participantCount: countParticipants(next) }),
      )
      .on(RoomEvent.ConnectionStateChanged, (connectionState: ConnectionState) => {
        if (connectionState === ConnectionState.Connected) {
          emit({ status: 'connected', participantCount: countParticipants(next) })
        }
      })
      .on(RoomEvent.Disconnected, () => {
        // Whatever ended it — a click, a dropped network, a server restart —
        // the state says idle and the room object goes.
        if (room === next) room = null
        emit({ ...IDLE })
      })

    try {
      emit({ status: 'connecting' })
      await next.connect(grant.url, grant.token)
      await next.localParticipant.setMicrophoneEnabled(true)
      emit({
        status: 'connected',
        micEnabled: true,
        participantCount: countParticipants(next),
      })
    } catch (error) {
      // A half-open room is worse than none: it holds a microphone.
      await next.disconnect().catch(() => undefined)
      if (room === next) room = null
      emit({ ...IDLE, status: 'error', error: toAppError(error).message })
      throw error
    }
  },

  async disconnect(): Promise<void> {
    const current = room
    room = null
    if (current) await current.disconnect().catch(() => undefined)
    emit({ ...IDLE })
  },

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (!room) return
    await room.localParticipant.setMicrophoneEnabled(enabled)
    emit({ micEnabled: enabled })
  },

  /** For tests and teardown: forget everything without touching a network. */
  reset(): void {
    room = null
    state = IDLE
    for (const listener of listeners) listener()
  },
}
