/**
 * The voice session, as the application sees it.
 *
 * Two things live here and nothing else: the state of the current session,
 * and the commands that change it. Both are deliberately free of
 * `livekit-client`, which is half a megabyte of WebRTC that most of this
 * application has no business loading — the sidebar needs to know whether you
 * are in a call, not how to be in one.
 *
 * So the media layer is loaded on demand. `voiceCommands` imports
 * `voice.service` the first time something asks for a room, and by the time
 * anything can be disconnected, muted or turned down it is already there.
 * Nothing here decides anything: every command is a call through to the one
 * module that owns the LiveKit Room.
 *
 * The session belongs to the application, not to a page. A page that unmounts
 * takes nothing with it; only an explicit Leave, a lost session, or the tab
 * itself closing ends a call.
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
  /** What to call it in a bar that is nowhere near the channel. */
  channelName: string | null
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
  /**
   * Whether the token permits a microphone at all.
   *
   * The server's answer, read from the grant rather than asked for. False
   * means listen-only: the interface offers no microphone, and the media
   * server would refuse the track even if it did.
   */
  canSpeak: boolean
  /** Holding a key to talk, rather than being open by default. */
  pushToTalk: boolean
  /**
   * The browser is refusing to play the room.
   *
   * Autoplay policy: a tab that has had no interaction may not make noise.
   * Joining is a click, so this is normally false — but a session restored
   * into a background tab, or a browser with stricter rules, can land here,
   * and silence with no explanation is the worst version of it.
   */
  audioBlocked: boolean
  error: string | null
}

export const IDLE_VOICE: VoiceState = {
  status: 'idle',
  channelId: null,
  channelName: null,
  participants: [],
  micEnabled: false,
  deafened: false,
  micBlocked: false,
  canSpeak: false,
  pushToTalk: false,
  audioBlocked: false,
  error: null,
}

let state: VoiceState = IDLE_VOICE
const listeners = new Set<() => void>()

/** Called by the media layer, and by nothing else. */
export function emitVoice(next: Partial<VoiceState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export const voiceSession = {
  getSnapshot: (): VoiceState => state,

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/**
 * The media layer, fetched the first time it is needed.
 *
 * A dynamic import so that WebRTC stays in its own chunk: the shell can render
 * a voice bar, and the channel panel can offer a Join button, without either
 * pulling LiveKit into the bundle everybody downloads.
 */
async function media() {
  const { voiceService } = await import('./voice.service')
  return voiceService
}

export const voiceCommands = {
  connect: async (channelId: string): Promise<void> => (await media()).connect(channelId),
  disconnect: async (): Promise<void> => (await media()).disconnect(),
  setMicrophoneEnabled: async (enabled: boolean): Promise<void> =>
    (await media()).setMicrophoneEnabled(enabled),
  setDeafened: async (deafened: boolean): Promise<void> => {
    ;(await media()).setDeafened(deafened)
  },
  setParticipantVolume: async (identity: string, volume: number): Promise<void> => {
    ;(await media()).setParticipantVolume(identity, volume)
  },
  setInputMode: async (mode: 'voice-activity' | 'push-to-talk'): Promise<void> =>
    (await media()).setInputMode(mode),
  setAudioProcessing: async (next: {
    echoCancellation?: boolean
    noiseSuppression?: boolean
    autoGainControl?: boolean
  }): Promise<void> => (await media()).setAudioProcessing(next),
  /** Ask the browser again, from a click, to let the room be heard. */
  unblockAudio: async (): Promise<void> => (await media()).unblockAudio(),

  /**
   * End a call because the account did, not because a page did.
   *
   * Signing out must not leave a microphone open, but it must also not drag
   * WebRTC into the bundle for somebody who has never opened a voice channel
   * — so this does nothing at all unless there is a session to end.
   */
  endForSignOut: async (): Promise<void> => {
    if (state.status === 'idle') return
    await (await media()).disconnect()
  },
}
