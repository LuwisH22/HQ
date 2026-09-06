import {
  ConnectionState,
  RemoteAudioTrack,
  Room,
  RoomEvent,
  Track,
  type AudioCaptureOptions,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RoomOptions,
} from 'livekit-client'
import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { demoVoiceService } from '@/services/demo'
import { clearAudioSink, isPlaying, playRemoteAudio, stopRemoteAudio } from './voice-audio'
import {
  emitVoice,
  IDLE_VOICE,
  voiceSession,
  type VoiceParticipant,
  type VoiceState,
} from './voice-session'
import {
  clampVolume,
  useVoiceStore,
  type AudioProcessing,
  type InputMode,
} from '@/stores/voice.store'

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
 *
 * KNOWN LIMITATION — authorization is checked when a token is issued, and a
 * token already spent is not reconsidered. Suspending somebody, banning them,
 * removing their access to a private voice channel or taking away
 * `voice.speak` all take effect immediately everywhere Postgres is asked:
 * every read they make returns nothing, and their next join is refused. It
 * does not reach a call already in progress, because LiveKit has never heard
 * of Supabase and refreshes a connected participant's token itself.
 *
 * Ending a live session from the server needs LiveKit's own room API —
 * `removeParticipant`, called from a trusted context — driven either by a
 * moderation action or by a webhook. That is server work this step does not
 * do, and pretending otherwise with a client-side check would be a boundary
 * that anybody could edit out. It is written down here rather than implied.
 */

/** What the Edge Function hands back. Nothing here is a secret but the token. */
interface VoiceGrant {
  token: string
  url: string
  room: string
  identity: string
  channelName: string
  /** Derived from the caller's permissions, in Postgres. Never asked for. */
  canSpeak: boolean
  expiresInSeconds: number
}

/**
 * The state lives in the session module, which the whole application can read
 * without loading any of this. This module is its only writer.
 */
const emit = emitVoice
const IDLE = IDLE_VOICE
const now = (): VoiceState => voiceSession.getSnapshot()

let room: Room | null = null

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
 * How loud this listener has set somebody, if they have.
 *
 * Absent means untouched, which is unity. A stored zero is a deliberate mute
 * and is left alone.
 */
function volumeFor(identity: string): number {
  const stored = useVoiceStore.getState().volumes[identity]
  return stored === undefined ? 1 : clampVolume(stored)
}

/** Give a track an element to come out of. This is what makes it audible. */
function playRemote(track: RemoteTrack, identity: string): void {
  if (!(track instanceof RemoteAudioTrack)) return
  // Once, however many ways the event arrives: a second element on the same
  // track is the same voice played twice.
  if (isPlaying(track)) return
  playRemoteAudio(track, identity, volumeFor(identity))
}

function stopRemote(track: RemoteTrack): void {
  if (!(track instanceof RemoteAudioTrack)) return
  stopRemoteAudio(track)
}

/**
 * Attach everything already being published when you arrive.
 *
 * LiveKit fires TrackSubscribed for tracks that existed before you joined, so
 * this is belt and braces — but a room that is silent for the person who
 * walked into it late is exactly the failure this path is for.
 */
function playEverything(current: Room): void {
  for (const participant of current.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.kind !== Track.Kind.Audio) continue
      const track = publication.track
      if (track instanceof RemoteAudioTrack && !isPlaying(track)) {
        playRemoteAudio(track, participant.identity, volumeFor(participant.identity))
      }
    }
  }
}

/** The microphone constraints this browser is currently asked for. */
function captureOptions(): AudioCaptureOptions {
  const { echoCancellation, noiseSuppression, autoGainControl } =
    useVoiceStore.getState().audioProcessing
  return { echoCancellation, noiseSuppression, autoGainControl }
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
    // offers, as the listener has them set. Nothing custom, no music mode, and
    // no analysis of anybody's audio: this is people talking.
    audioCaptureDefaults: captureOptions(),
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
      if (now().deafened) {
        for (const publication of remoteAudio(next)) publication.setSubscribed(false)
      }
      refresh()
    })
    .on(RoomEvent.ParticipantDisconnected, refresh)
    .on(RoomEvent.TrackPublished, (publication: RemoteTrackPublication) => {
      if (now().deafened && publication.kind === Track.Kind.Audio) {
        publication.setSubscribed(false)
      }
      refresh()
    })
    .on(RoomEvent.TrackUnpublished, refresh)
    .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      // The moment sound becomes audible. Subscribing gets the bytes; this
      // gets them out of a speaker.
      playRemote(track, participant.identity)
      refresh()
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      // Which is also how deafen goes quiet: unsubscribing fires this.
      stopRemote(track)
      refresh()
    })
    .on(RoomEvent.AudioPlaybackStatusChanged, () => {
      // The browser deciding whether this tab may make noise.
      emit({ audioBlocked: !next.canPlaybackAudio })
    })
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
      // the state says idle, and the room and its sound both go.
      if (room !== next) return
      room = null
      clearAudioSink()
      emit({ ...IDLE })
    })
}

/**
 * Push-to-talk.
 *
 * The listeners belong to the session rather than to a component: a page that
 * remounts must not be able to leave two of them attached, or to leave one
 * attached after the room has gone. They are added when a room opens in
 * push-to-talk and removed on disconnect, on a change of mode, and on the
 * events that mean the key can no longer be observed being released.
 *
 * The key is only taken while it can be acted on: typing a space into a
 * message is a space, and the default is never prevented unless the key is
 * actually being used to talk.
 *
 * When it is being used to talk it is taken in the capture phase and stopped
 * there, because otherwise the button that happens to have focus opens a menu
 * or presses itself before the microphone hears about it. The cost is that
 * Space stops activating buttons while push-to-talk is on and you are in a
 * room — Enter still does, everywhere — and that is the trade a reserved key
 * is. Somebody who wants Space back can bind push-to-talk elsewhere.
 */
let pttAttached = false

/**
 * Whether a key press belongs to whatever the person is typing into.
 *
 * Exported because it is the rule that keeps push-to-talk from eating a space
 * out of a message, and it is worth being able to state that in a test without
 * a media server. `closest` rather than a tag check, so a key pressed inside a
 * contenteditable's own child still counts as typing.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.closest !== 'function') return false
  return Boolean(
    element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'),
  )
}

function pttKeyDown(event: KeyboardEvent): void {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
  if (event.code !== useVoiceStore.getState().pushToTalkKey) return
  if (isTypingTarget(event.target)) return
  if (!room || !now().canSpeak) return

  // Only now, and only for this key: Space keeps scrolling the page, and
  // pressing buttons, everywhere it is not being used to talk.
  event.preventDefault()
  event.stopPropagation()
  if (!now().micEnabled) void voiceService.setMicrophoneEnabled(true)
}

function pttKeyUp(event: KeyboardEvent): void {
  if (event.code !== useVoiceStore.getState().pushToTalkKey) return
  if (!room) return
  event.preventDefault()
  event.stopPropagation()
  if (now().micEnabled) void voiceService.setMicrophoneEnabled(false)
}

/**
 * Anything that means the key-up may never arrive.
 *
 * A window that loses focus mid-press, a tab that goes to the background, a
 * page being torn down: in each of them the browser stops delivering key
 * events, and a microphone left open because nobody saw the release is the
 * one failure a push-to-talk must not have.
 */
function pttRelease(): void {
  if (!room) return
  if (now().micEnabled) void voiceService.setMicrophoneEnabled(false)
}

function attachPushToTalk(): void {
  if (pttAttached) return
  pttAttached = true
  // Capture, so the key reaches the microphone before it reaches whatever
  // has focus.
  window.addEventListener('keydown', pttKeyDown, true)
  window.addEventListener('keyup', pttKeyUp, true)
  window.addEventListener('blur', pttRelease)
  document.addEventListener('visibilitychange', pttRelease)
}

function detachPushToTalk(): void {
  if (!pttAttached) return
  pttAttached = false
  window.removeEventListener('keydown', pttKeyDown, true)
  window.removeEventListener('keyup', pttKeyUp, true)
  window.removeEventListener('blur', pttRelease)
  document.removeEventListener('visibilitychange', pttRelease)
}

export const voiceService = {
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
    if (now().status === 'connected' && now().channelId === channelId) return
    await voiceService.disconnect()

    emit({ ...IDLE, status: 'requesting', channelId })

    let grant: VoiceGrant
    try {
      grant = await requestVoiceGrant(channelId)
    } catch (error) {
      emit({ status: 'error', error: toAppError(error).message })
      throw error
    }

    // Both are the server's answer, and both are needed before anything can
    // report the room as connected: LiveKit's own ConnectionStateChanged can
    // arrive first, and a bar that renders "connected" without knowing whether
    // there is a microphone flickers one in and out of existence.
    emit({ channelName: grant.channelName, canSpeak: grant.canSpeak === true })

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

    // Anyone already talking when you walked in.
    playEverything(next)
    emit({
      status: 'connected',
      audioBlocked: !next.canPlaybackAudio,
      participants: snapshotParticipants(next),
    })

    // Joining was a click, which is the gesture browsers want before a page
    // may make noise. Spending it here is what keeps the room audible.
    if (!next.canPlaybackAudio) {
      await next.startAudio().catch(() => undefined)
      emit({ audioBlocked: !next.canPlaybackAudio })
    }

    // Listen-only. The token refuses a microphone, so asking the browser for
    // one would be a permission prompt in aid of nothing.
    if (grant.canSpeak !== true) return

    const pushToTalk = useVoiceStore.getState().inputMode === 'push-to-talk'
    emit({ pushToTalk })

    // Only now, and only because somebody pressed Join. Opening the page
    // never reaches this line.
    try {
      await next.localParticipant.setMicrophoneEnabled(true, captureOptions())
      if (pushToTalk) {
        // Published, then closed. The track exists, so holding the key is
        // instant and never asks for permission again.
        await next.localParticipant.setMicrophoneEnabled(false)
        attachPushToTalk()
      }
      emit({
        micEnabled: !pushToTalk,
        micBlocked: false,
        participants: snapshotParticipants(next),
      })
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
    // Before anything awaits: a key pressed during teardown must find no room
    // to talk into.
    detachPushToTalk()
    // LiveKit stops and unpublishes the local tracks as part of this, which is
    // what actually turns the microphone light off.
    if (current) await current.disconnect().catch(() => undefined)
    // And the elements it was coming out of.
    clearAudioSink()
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

  /**
   * How loud somebody else is, here.
   *
   * Local playback only. It is remembered per identity in this browser, and
   * the person it applies to is neither told nor affected — their microphone,
   * and what everybody else hears, are untouched.
   */
  setParticipantVolume(identity: string, volume: number): void {
    const clamped = clampVolume(volume)
    useVoiceStore.getState().setVolume(identity, clamped)

    const current = room
    if (!current) return
    const participant = current.remoteParticipants.get(identity)
    if (!participant) return

    for (const publication of participant.trackPublications.values()) {
      const track = publication.track
      if (track instanceof RemoteAudioTrack) track.setVolume(clamped)
    }
  },

  /**
   * Switch between talking freely and holding a key.
   *
   * Neither touches the room. Going to push-to-talk closes the microphone
   * that is already published; coming back opens it again.
   */
  async setInputMode(mode: InputMode): Promise<void> {
    useVoiceStore.getState().setInputMode(mode)
    const pushToTalk = mode === 'push-to-talk'
    emit({ pushToTalk })

    if (!room || !now().canSpeak) {
      detachPushToTalk()
      return
    }

    if (pushToTalk) {
      attachPushToTalk()
      await voiceService.setMicrophoneEnabled(false)
    } else {
      detachPushToTalk()
      await voiceService.setMicrophoneEnabled(true)
    }
  },

  /**
   * Echo cancellation, noise suppression and gain control.
   *
   * These are constraints on the capture, so they take effect when a track is
   * made rather than while one is running. Changing them replaces the
   * microphone track and leaves the room alone: nobody is disconnected and
   * nobody else notices.
   *
   * There is deliberately no input-sensitivity control. LiveKit's browser SDK
   * exposes no publish-side voice-activity threshold, and the only way to
   * offer one would be to analyse the microphone here — which is exactly the
   * custom DSP this project does not want.
   */
  async setAudioProcessing(next: Partial<AudioProcessing>): Promise<void> {
    useVoiceStore.getState().setAudioProcessing(next)

    const current = room
    if (!current || !now().canSpeak) return

    const publication = current.localParticipant.getTrackPublication(Track.Source.Microphone)
    const track = publication?.track
    if (!track) return

    const wasOpen = now().micEnabled
    try {
      // Dropped and remade: a live track keeps the constraints it was born
      // with, so re-enabling an existing one would change nothing.
      await current.localParticipant.unpublishTrack(track, true)
      await current.localParticipant.setMicrophoneEnabled(true, captureOptions())
      if (!wasOpen) await current.localParticipant.setMicrophoneEnabled(false)
      emit({ micEnabled: wasOpen, participants: snapshotParticipants(current) })
    } catch (error) {
      emit({ micEnabled: false, micBlocked: true, error: micRefusal(error) })
    }
  },

  /**
   * Ask the browser again, from a click, to let the room be heard.
   *
   * Autoplay is granted to a gesture, so this exists to be wired to a button
   * rather than called on a timer.
   */
  async unblockAudio(): Promise<void> {
    const current = room
    if (!current) return
    await current.startAudio().catch(() => undefined)
    emit({ audioBlocked: !current.canPlaybackAudio })
  },

  /** For tests and teardown: forget everything without touching a network. */
  reset(): void {
    detachPushToTalk()
    clearAudioSink()
    room = null
    emit({ ...IDLE })
  },
}
