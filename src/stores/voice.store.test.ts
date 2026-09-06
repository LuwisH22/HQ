import { beforeEach, describe, expect, it } from 'vitest'
import { clampVolume, MAX_VOLUME, useVoiceStore } from './voice.store'

/**
 * Voice preferences.
 *
 * All of it is local: how loud somebody is to you, whether you hold a key to
 * talk, what your microphone does to your voice on the way out. None of it is
 * sent anywhere, none of it is asked of a server, and none of it decides
 * whether a microphone is allowed — that answer arrives in a token.
 */

beforeEach(() => {
  localStorage.clear()
  useVoiceStore.setState({
    inputMode: 'voice-activity',
    pushToTalkKey: 'Space',
    audioProcessing: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    volumes: {},
  })
})

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('what it starts as', () => {
  it('talks freely rather than holding a key', () => {
    // Push-to-talk is a surprise unless it was asked for.
    expect(useVoiceStore.getState().inputMode).toBe('voice-activity')
    expect(useVoiceStore.getState().pushToTalkKey).toBe('Space')
  })

  it('runs the three processors a browser offers', () => {
    expect(useVoiceStore.getState().audioProcessing).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    })
  })

  it('has nothing to say about anybody’s volume', () => {
    // Absent, not 1: a store that grew a row for everybody ever heard would
    // be a list of who you have been in a room with.
    expect(useVoiceStore.getState().volumes).toEqual({})
  })
})

describe('volume', () => {
  it('is kept per person, and one does not move another', () => {
    useVoiceStore.getState().setVolume(A, 0.3)
    expect(useVoiceStore.getState().volumes[A]).toBe(0.3)
    expect(useVoiceStore.getState().volumes[B]).toBeUndefined()

    useVoiceStore.getState().setVolume(B, 0.9)
    expect(useVoiceStore.getState().volumes[A]).toBe(0.3)
    expect(useVoiceStore.getState().volumes[B]).toBe(0.9)
  })

  it('clamps to what the browser will actually take', () => {
    // LiveKit writes HTMLMediaElement.volume, which is 0–1. Anything else
    // would be a number that silently did nothing, or threw.
    expect(clampVolume(-1)).toBe(0)
    expect(clampVolume(0)).toBe(0)
    expect(clampVolume(0.5)).toBe(0.5)
    expect(clampVolume(2)).toBe(MAX_VOLUME)
    expect(clampVolume(Number.NaN)).toBe(MAX_VOLUME)
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(MAX_VOLUME)
  })

  it('clamps on the way in, not only on the way out', () => {
    useVoiceStore.getState().setVolume(A, 12)
    expect(useVoiceStore.getState().volumes[A]).toBe(MAX_VOLUME)
  })

  it('forgets somebody put back to normal', () => {
    useVoiceStore.getState().setVolume(A, 0.2)
    useVoiceStore.getState().resetVolume(A)
    expect(useVoiceStore.getState().volumes).toEqual({})
  })

  it('survives being written and read again, which is what persistence is', () => {
    useVoiceStore.getState().setVolume(A, 0.4)
    // The persist middleware writes synchronously; this is the same bytes a
    // reload would rehydrate from.
    const stored = JSON.parse(localStorage.getItem('lfg-hq-voice') ?? '{}') as {
      state?: { volumes?: Record<string, number> }
    }
    expect(stored.state?.volumes?.[A]).toBe(0.4)
  })
})

describe('input mode', () => {
  it('can be turned on and off again', () => {
    useVoiceStore.getState().setInputMode('push-to-talk')
    expect(useVoiceStore.getState().inputMode).toBe('push-to-talk')
    useVoiceStore.getState().setInputMode('voice-activity')
    expect(useVoiceStore.getState().inputMode).toBe('voice-activity')
  })

  it('remembers a key as a key on the board, not as a character', () => {
    // A KeyboardEvent.code, so a different layout still means the same key.
    useVoiceStore.getState().setPushToTalkKey('ControlLeft')
    expect(useVoiceStore.getState().pushToTalkKey).toBe('ControlLeft')
  })
})

describe('microphone processing', () => {
  it('changes one without disturbing the others', () => {
    useVoiceStore.getState().setAudioProcessing({ noiseSuppression: false })
    expect(useVoiceStore.getState().audioProcessing).toEqual({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    })
  })
})
