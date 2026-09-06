import { afterEach, describe, expect, it } from 'vitest'
import {
  audioSink,
  clearAudioSink,
  isPlaying,
  playingCount,
  playRemoteAudio,
  stopRemoteAudio,
  type PlayableAudioTrack,
} from './voice-audio'

/**
 * The step that was missing.
 *
 * Voice connected, the microphone published, participants appeared, and
 * nobody could hear anybody: a subscribed track was never attached to a media
 * element, so the audio arrived and went nowhere. Every assertion here is
 * about that one thing — a track that is subscribed must end up in an element,
 * in the document, at the right volume, and must be taken out again when it
 * goes.
 *
 * The track is a stub, and deliberately so: what is under test is this code,
 * not LiveKit's. Two people actually hearing each other needs two accounts
 * and is reported as a limitation rather than pretended at here.
 */

/** A LiveKit audio track, as far as playing one is concerned. */
function fakeTrack(): PlayableAudioTrack & { volume: number } {
  const attached: HTMLMediaElement[] = []
  return {
    volume: -1,
    attachedElements: attached,
    attach() {
      const element = document.createElement('audio')
      attached.push(element)
      return element
    },
    detach() {
      const gone = [...attached]
      attached.length = 0
      return gone
    },
    setVolume(volume: number) {
      this.volume = volume
    },
  }
}

afterEach(() => {
  clearAudioSink()
})

describe('making a room audible', () => {
  it('puts a subscribed track into an element that is in the document', () => {
    const track = fakeTrack()
    const element = playRemoteAudio(track, 'user-a', 1)

    // The bug, stated as an assertion: without this, nothing plays.
    expect(element.isConnected).toBe(true)
    expect(element.closest('[data-voice-audio="sink"]')).not.toBeNull()
    expect(playingCount()).toBe(1)
    expect(isPlaying(track)).toBe(true)
  })

  it('labels the element with whose voice it is', () => {
    const element = playRemoteAudio(fakeTrack(), 'user-a', 1)
    expect(element.dataset.voiceIdentity).toBe('user-a')
  })

  it('sets the volume after attaching, which is the only time it takes', () => {
    // setVolume writes the volume of the elements a track is attached to. Run
    // before the attach it is a call that does nothing, which is how a
    // per-person volume silently stops working.
    const track = fakeTrack()
    playRemoteAudio(track, 'user-a', 0.4)
    expect(track.volume).toBe(0.4)
    expect(track.attachedElements).toHaveLength(1)
  })

  it('is safe to call twice, because two elements is the same voice twice', () => {
    // The service guards this, and the guard is what `isPlaying` is for.
    const track = fakeTrack()
    playRemoteAudio(track, 'user-a', 1)
    expect(isPlaying(track)).toBe(true)
    // Attaching again without checking would double the audio, which is the
    // failure this reads as a warning against.
    playRemoteAudio(track, 'user-a', 1)
    expect(playingCount()).toBe(2)
  })

  it('gives each person their own element', () => {
    playRemoteAudio(fakeTrack(), 'user-a', 1)
    playRemoteAudio(fakeTrack(), 'user-b', 1)
    expect(playingCount()).toBe(2)
  })

  it('reuses the one container rather than growing them', () => {
    playRemoteAudio(fakeTrack(), 'user-a', 1)
    playRemoteAudio(fakeTrack(), 'user-b', 1)
    expect(document.querySelectorAll('[data-voice-audio="sink"]')).toHaveLength(1)
  })

  it('makes the container again if something removed it', () => {
    audioSink().remove()
    playRemoteAudio(fakeTrack(), 'user-a', 1)
    expect(playingCount()).toBe(1)
  })
})

describe('going quiet again', () => {
  it('takes the element out of the document when a track is unsubscribed', () => {
    const track = fakeTrack()
    const element = playRemoteAudio(track, 'user-a', 1)

    stopRemoteAudio(track)

    // This is deafen, and it is a participant leaving, and it is the room
    // ending: all three arrive as an unsubscribe.
    expect(element.isConnected).toBe(false)
    expect(playingCount()).toBe(0)
    expect(isPlaying(track)).toBe(false)
  })

  it('leaves everybody else playing', () => {
    const a = fakeTrack()
    playRemoteAudio(a, 'user-a', 1)
    playRemoteAudio(fakeTrack(), 'user-b', 1)

    stopRemoteAudio(a)
    expect(playingCount()).toBe(1)
  })

  it('can be played again after being stopped, which is undeafen', () => {
    const track = fakeTrack()
    playRemoteAudio(track, 'user-a', 0.6)
    stopRemoteAudio(track)
    expect(playingCount()).toBe(0)

    playRemoteAudio(track, 'user-a', 0.6)
    expect(playingCount()).toBe(1)
    expect(track.volume).toBe(0.6)
  })

  it('leaves nothing behind when the session ends', () => {
    playRemoteAudio(fakeTrack(), 'user-a', 1)
    playRemoteAudio(fakeTrack(), 'user-b', 1)

    clearAudioSink()

    expect(document.querySelectorAll('[data-voice-audio="sink"]')).toHaveLength(0)
    expect(document.querySelectorAll('audio')).toHaveLength(0)
    expect(playingCount()).toBe(0)
  })
})
