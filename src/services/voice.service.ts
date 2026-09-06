import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrackPublication,
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
 * about channel ids and a snapshot of state and never about rooms or tracks.
 *
 * Authorization is not here. The client asks the `voice-token` Edge Function
 * for permission to be in a channel, and that function asks Postgres under the
 * caller's own JWT. What comes back is a token for one room, valid for ten
 * minutes, allowing a microphone and nothing else. This module cannot mint
 * one, cannot name a room, and cannot widen a grant — it can only spend what
 * it is given.
 *
 * The snapshot is rebuilt from LiveKit's own events rather than polled, and it
 * is the only thing React sees. Nothing about a session is written to
 * Postgres: who is in a room and who is talking is true only while the room
 * lasts, and LiveKit is where that lives.
 */

export type VoiceStatus =
  'idle' | 'requesting' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface VoiceParticipant {
  /** The Supabase user id, which is what the token puts in the room. */
  identity: string
  name: string
  isLocal: boolean
  speaking: boolean
  /** No microphone published, or one that is muted. They read the same. */
  muted: boolean
}

export interface VoiceState {
  status: VoiceStatus
  /** The LFG HQ channel, never a room name: the room is the server's word. */
  channelId: string | null
  participants: readonly VoiceParticipant[]
  micEnabled: boolean
  /** Local only. Nobody else can tell, and nobody else is affected. */
  deafened: boolean
  /**
   * Connected, but with no microphone: permission was refused or there is no
   * device. Listening still works, which is why this is a state to be in and
   * not a failure to join.
   */
  micBlocked: boolean
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
  participants: [],
  micEnabled: false,
  deafened: false,
  micBlocked: false,
  error: null,
}

let state: VoiceState = IDLE
let room: Room | null = null
const listeners = new Set<() => void>()

function emit(next: Partial<VoiceState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function describe(participant: Participant, isLocal: boolean): VoiceParticipant {
  return {
    identity: participant.identity,
    // A token always carries one, but the type says it might not.
    name: participant.name || participant.identity,
    isLocal,
    speaking: participant.isSpeaking,
    muted: !participant.isMicrophoneEnabled,
  }
}

/**
 * The room as it is right now.
 *
 * Read from LiveKit rather than accumulated: an event says something changed,
 * and this says what is true afterwards. There is no second copy of the
 * participant list to drift out of step with the first.
 */
function snapshotParticipants(current: Room): VoiceParticipant[] {
  const you = describe(current.localParticipant, true)
  const others = [...current.remoteParticipants.values()]
    .map((participant) => describe(participant, false))
    .sort((a, b) => a.name.localeCompare(b.name))
  return [you, ...others]
}

function refreshParticipants(current: Room): void {
  if (room !== current) return
  emit({ participants: snapshotParticipants(current) })
}

/** Every remote audio publication in the room, which is all deafen touches. */
function remoteAudio(current: Room): RemoteTrackPublication[] {
  return [...current.remoteParticipants.values()].flatMap((participant) =>
    [...participant.trackPublications.values()].filter(
      (publication): publication is RemoteTrackPublication => publication.kind === Track.Kind.Audio,
    ),
  )
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
    // The SDK's own voice path — Opus, with the three processors a browser
    // offers. Nothing custom, and no music mode: this is people talking.
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  }
}

/** Whether a failed publish was the person saying no, or the machine. */
function micRefusal(error: unknown): string {
  const name = (error as { name?: string }).name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access is required to speak. You are connected and can still listen.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found. You are connected and can still listen.'
  }
  return `The microphone could not be started: ${toAppError(error).message}`
}

function wire(next: Room): void {
  const refresh = () => {
    refreshParticipants(next)
  }

  next
    .on(RoomEvent.ParticipantConnected, () => {
      // Somebody arriving while you are deafened does not get to be heard.
      if (state.deafened) {
        for (const publication of remoteAudio(next)) publication.setSubscribed(false)
      }
      refresh()
    })
    .on(RoomEvent.ParticipantDisconnected, refresh)
    .on(RoomEvent.TrackPublished, (publication: RemoteTrackPublication) => {
      if (state.deafened && publication.kind === Track.Kind.Audio) {
        publication.setSubscribed(false)
      }
      refresh()
    })
    .on(RoomEvent.TrackUnpublished, refresh)
    .on(RoomEvent.TrackSubscribed, refresh)
    .on(RoomEvent.TrackUnsubscribed, refresh)
    .on(RoomEvent.TrackMuted, refresh)
    .on(RoomEvent.TrackUnmuted, refresh)
    .on(RoomEvent.LocalTrackPublished, refresh)
    .on(RoomEvent.LocalTrackUnpublished, refresh)
    // The SDK decides who is speaking. There is no audio analysis here, and
    // there should not be: it already knows.
    .on(RoomEvent.ActiveSpeakersChanged, refresh)
    .on(RoomEvent.ConnectionStateChanged, (connectionState: ConnectionState) => {
      if (room !== next) return
      if (connectionState === ConnectionState.Connected) {
        emit({ status: 'connected', error: null, participants: snapshotParticipants(next) })
      } else if (
        connectionState === ConnectionState.Reconnecting ||
        connectionState === ConnectionState.SignalReconnecting
      ) {
        // LiveKit recovers on its own, with the token it already holds.
        // Nothing here retries, and nothing here asks the server for anything.
        emit({ status: 'reconnecting' })
      }
    })
    .on(RoomEvent.Disconnected, () => {
      // Whatever ended it — a click, a dropped network, a server giving up —
      // the state says idle and the room object goes.
      if (room !== next) return
      room = null
      emit({ ...IDLE })
    })
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
   * Join the voice channel.
   *
   * The room first, the microphone second. Connecting is what was asked for;
   * a microphone is what the person would like to have, and being refused one
   * is a state to be in rather than a reason to fail — somebody who cannot be
   * heard can still listen.
   *
   * A fresh token every time. They last ten minutes, which is plenty to
   * connect with and not worth stealing; once connected, LiveKit refreshes a
   * participant's token itself, so a long call never leans on this one.
   */
  async connect(channelId: string): Promise<void> {
    if (state.status === 'connected' && state.channelId === channelId) return
    await voiceService.disconnect()

    emit({ ...IDLE, status: 'requesting', channelId })

    let grant: VoiceGrant
    try {
      grant = await requestVoiceGrant(channelId)
    } catch (error) {
      emit({ status: 'error', error: toAppError(error).message })
      throw error
    }

    const next = new Room(roomOptions())
    room = next
    wire(next)

    try {
      emit({ status: 'connecting' })
      await next.connect(grant.url, grant.token)
    } catch (error) {
      // A half-open room is worse than none: it holds a connection nobody can
      // see and nobody can leave.
      await next.disconnect().catch(() => undefined)
      if (room === next) room = null
      emit({ ...IDLE, status: 'error', channelId, error: toAppError(error).message })
      throw error
    }

    emit({ status: 'connected', participants: snapshotParticipants(next) })

    // Only now, and only because somebody pressed Join. Opening the page
    // never reaches this line.
    try {
      await next.localParticipant.setMicrophoneEnabled(true)
      emit({ micEnabled: true, micBlocked: false, participants: snapshotParticipants(next) })
    } catch (error) {
      emit({
        micEnabled: false,
        micBlocked: true,
        error: micRefusal(error),
        participants: snapshotParticipants(next),
      })
    }
  },

  async disconnect(): Promise<void> {
    const current = room
    room = null
    // LiveKit stops and unpublishes the local tracks as part of this, which is
    // what actually turns the microphone light off.
    if (current) await current.disconnect().catch(() => undefined)
    emit({ ...IDLE })
  },

  /**
   * Mute or unmute, on the connection that is already open.
   *
   * Unmuting is also the retry after a refused permission: it is the same
   * call, and the browser asks again if it is willing to.
   */
  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    const current = room
    if (!current) return

    try {
      await current.localParticipant.setMicrophoneEnabled(enabled)
      emit({
        micEnabled: enabled,
        micBlocked: false,
        error: null,
        participants: snapshotParticipants(current),
      })
    } catch (error) {
      emit({ micEnabled: false, micBlocked: true, error: micRefusal(error) })
    }
  },

  /**
   * Stop hearing the room, or start again.
   *
   * Unsubscribing rather than turning a volume down: the audio stops being
   * sent at all. Entirely local — the people in the room are not told, and
   * nothing about what they can hear changes.
   */
  setDeafened(deafened: boolean): void {
    const current = room
    if (!current) return

    for (const publication of remoteAudio(current)) publication.setSubscribed(!deafened)
    emit({ deafened })
  },

  /** For tests and teardown: forget everything without touching a network. */
  reset(): void {
    room = null
    state = IDLE
    for (const listener of listeners) listener()
  },
}
