import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playVoiceCue, resetVoiceSoundsForTest } from './voice-sounds'

/**
 * The chime, and the several ways a browser can refuse to play one.
 *
 * jsdom has no Web Audio, which makes it the right place to check the part
 * that matters most: silence is always an acceptable outcome, and an exception
 * never is. A notification must not be able to break a call.
 */

interface FakeNode {
  connect: ReturnType<typeof vi.fn>
}

function fakeContext(state: AudioContextState = 'running') {
  const started: number[] = []
  const frequencies: number[] = []

  const ctx = {
    state,
    currentTime: 0,
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    destination: {} as AudioNode,
    createOscillator: vi.fn(() => ({
      type: 'sine',
      frequency: {
        setValueAtTime: vi.fn((value: number) => {
          frequencies.push(value)
        }),
      },
      connect: vi.fn(),
      start: vi.fn((at: number) => {
        started.push(at)
      }),
      stop: vi.fn(),
    })),
    createGain: vi.fn((): FakeNode & { gain: Record<string, ReturnType<typeof vi.fn>> } => ({
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    })),
  }

  return { ctx, started, frequencies }
}

function install(factory: () => unknown): void {
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: factory,
  })
}

beforeEach(() => {
  resetVoiceSoundsForTest()
})

afterEach(() => {
  resetVoiceSoundsForTest()
  Reflect.deleteProperty(window, 'AudioContext')
  Reflect.deleteProperty(window, 'webkitAudioContext')
})

describe('with no Web Audio at all', () => {
  it('does not throw, and says it played nothing', () => {
    // jsdom's default: no AudioContext on window.
    expect(() => playVoiceCue('join')).not.toThrow()
    expect(playVoiceCue('join')).toBe(false)
    expect(playVoiceCue('leave')).toBe(false)
  })
})

describe('when the context cannot be built', () => {
  it('fails silently and does not try again', () => {
    const constructor = vi.fn(() => {
      throw new Error('not allowed')
    })
    install(constructor)

    expect(playVoiceCue('join')).toBe(false)
    expect(playVoiceCue('join')).toBe(false)
    // Asked once, refused once, never asked again.
    expect(constructor).toHaveBeenCalledTimes(1)
  })
})

describe('when a node cannot be built', () => {
  it('swallows it rather than breaking the call', () => {
    const { ctx } = fakeContext()
    ctx.createOscillator = vi.fn(() => {
      throw new Error('no more oscillators')
    })
    install(function FakeContext() {
      return ctx
    })

    expect(() => playVoiceCue('leave')).not.toThrow()
    expect(playVoiceCue('leave')).toBe(false)
  })
})

describe('when Web Audio is available', () => {
  it('plays two notes, ascending to arrive and descending to leave', () => {
    const join = fakeContext()
    install(function FakeContext() {
      return join.ctx
    })

    expect(playVoiceCue('join')).toBe(true)
    expect(join.frequencies).toHaveLength(2)
    expect(join.frequencies[1]).toBeGreaterThan(join.frequencies[0] as number)

    expect(playVoiceCue('leave')).toBe(true)
    const [, , first, second] = join.frequencies
    expect(second).toBeLessThan(first as number)
  })

  it('builds one context however many cues are played', () => {
    const { ctx } = fakeContext()
    const constructor = vi.fn(function FakeContext() {
      return ctx
    })
    install(constructor)

    playVoiceCue('join')
    playVoiceCue('leave')
    playVoiceCue('join')
    expect(constructor).toHaveBeenCalledTimes(1)
  })

  it('keeps the whole cue under a quarter of a second', () => {
    const { ctx, started } = fakeContext()
    install(function FakeContext() {
      return ctx
    })

    playVoiceCue('join')
    expect(Math.max(...started)).toBeLessThan(0.25)
  })

  it('asks a suspended context to resume rather than giving up', () => {
    const { ctx } = fakeContext('suspended')
    install(function FakeContext() {
      return ctx
    })

    expect(playVoiceCue('join')).toBe(true)
    expect(ctx.resume).toHaveBeenCalled()
  })

  it('falls back to the prefixed constructor', () => {
    const { ctx } = fakeContext()
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      writable: true,
      value: function FakeContext() {
        return ctx
      },
    })

    expect(playVoiceCue('join')).toBe(true)
  })
})
