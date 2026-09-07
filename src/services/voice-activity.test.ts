import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginVoiceActivity,
  recordVoiceActivity,
  resetVoiceActivityForTest,
  voiceActivity,
  MAX_VOICE_ACTIVITY,
} from './voice-activity'
import { useVoiceStore } from '@/stores/voice.store'

vi.mock('./voice-sounds', () => ({ playVoiceCue: vi.fn(() => true) }))
const { playVoiceCue } = await import('./voice-sounds')

/**
 * The log of who came and went.
 *
 * Everything worth checking here is about what does *not* get recorded: a
 * lifecycle callback that fires twice, a reconnect that re-announces a room
 * full of people, a page that mounts. The rule is that an event which does not
 * change who is present did not happen, and these are that rule.
 */

const AGER = { identity: 'user-ager', name: 'AGER', isLocal: false }
const ADIT = { identity: 'user-adit', name: 'Adit si keren', isLocal: false }
const ME = { identity: 'user-me', name: 'LuwisH', isLocal: true }

beforeEach(() => {
  resetVoiceActivityForTest()
  useVoiceStore.setState({ voiceActivitySoundsEnabled: true })
  vi.mocked(playVoiceCue).mockClear()
})

describe('arriving', () => {
  it('records a join once', () => {
    expect(recordVoiceActivity({ kind: 'join', ...AGER })).toBe(true)

    const events = voiceActivity.getSnapshot()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'join', identity: 'user-ager', name: 'AGER' })
  })

  it('ignores a second callback for somebody already here', () => {
    recordVoiceActivity({ kind: 'join', ...AGER })
    expect(recordVoiceActivity({ kind: 'join', ...AGER })).toBe(false)
    expect(voiceActivity.getSnapshot()).toHaveLength(1)
  })
})

describe('leaving', () => {
  it('records a leave once', () => {
    recordVoiceActivity({ kind: 'join', ...AGER })
    expect(recordVoiceActivity({ kind: 'leave', ...AGER })).toBe(true)
    expect(voiceActivity.getSnapshot()[0]).toMatchObject({ kind: 'leave', identity: 'user-ager' })
  })

  it('ignores a second departure for somebody already gone', () => {
    recordVoiceActivity({ kind: 'join', ...AGER })
    recordVoiceActivity({ kind: 'leave', ...AGER })
    expect(recordVoiceActivity({ kind: 'leave', ...AGER })).toBe(false)
    expect(voiceActivity.getSnapshot()).toHaveLength(2)
  })

  it('never records a departure for somebody who was never here', () => {
    // Which is what a panel mounting, or a stray callback after a room has
    // gone, would otherwise produce.
    expect(recordVoiceActivity({ kind: 'leave', ...ADIT })).toBe(false)
    expect(voiceActivity.getSnapshot()).toHaveLength(0)
  })
})

describe('opening a room', () => {
  it('seeds whoever was already in it without announcing them', () => {
    beginVoiceActivity('channel-1', [{ identity: 'user-ager' }, { identity: 'user-adit' }])
    expect(voiceActivity.getSnapshot()).toHaveLength(0)

    // They were already here, so their arrival is not news...
    expect(recordVoiceActivity({ kind: 'join', ...AGER })).toBe(false)
    // ...but their departure still is.
    expect(recordVoiceActivity({ kind: 'leave', ...AGER })).toBe(true)
  })

  it('starts a fresh log for a new room', () => {
    recordVoiceActivity({ kind: 'join', ...AGER })
    beginVoiceActivity('channel-1')
    expect(voiceActivity.getSnapshot()).toHaveLength(0)
  })

  it('stamps each event with the room it happened in', () => {
    // Which is what lets the panel beside one channel ignore a call in
    // another, and what keeps your own departure on screen after the session
    // that recorded it has ended.
    beginVoiceActivity('channel-7')
    recordVoiceActivity({ kind: 'join', ...AGER })
    expect(voiceActivity.getSnapshot()[0]?.channelId).toBe('channel-7')
  })
})

describe('a reconnect', () => {
  it('adds nothing when LiveKit re-announces the room it recovered', () => {
    beginVoiceActivity('channel-1')
    recordVoiceActivity({ kind: 'join', ...ME })
    recordVoiceActivity({ kind: 'join', ...AGER })
    recordVoiceActivity({ kind: 'join', ...ADIT })
    const before = voiceActivity.getSnapshot()

    // A resumed session re-fires ParticipantConnected for everybody who never
    // actually left. None of it changes who is present, so none of it is
    // recorded.
    recordVoiceActivity({ kind: 'join', ...AGER })
    recordVoiceActivity({ kind: 'join', ...ADIT })

    expect(voiceActivity.getSnapshot()).toEqual(before)
    expect(voiceActivity.getSnapshot()).toHaveLength(3)
  })

  it('does not treat navigating the app as leaving', () => {
    // There is no code path from a route change to this module: a page that
    // unmounts records nothing, so the log after "navigating" is the log
    // before it.
    beginVoiceActivity('channel-1')
    recordVoiceActivity({ kind: 'join', ...ME })
    recordVoiceActivity({ kind: 'join', ...AGER })
    const before = voiceActivity.getSnapshot()

    voiceActivity.subscribe(() => undefined)() // mount and unmount a reader

    expect(voiceActivity.getSnapshot()).toEqual(before)
    expect(voiceActivity.getSnapshot().some((event) => event.kind === 'leave')).toBe(false)
  })
})

describe('the log itself', () => {
  it('keeps the newest first', () => {
    recordVoiceActivity({ kind: 'join', ...AGER })
    recordVoiceActivity({ kind: 'join', ...ADIT })
    expect(voiceActivity.getSnapshot()[0]?.identity).toBe('user-adit')
  })

  it(`keeps at most ${String(MAX_VOICE_ACTIVITY)} events`, () => {
    for (let i = 0; i < MAX_VOICE_ACTIVITY + 12; i += 1) {
      const person = { identity: `user-${String(i)}`, name: `Person ${String(i)}`, isLocal: false }
      recordVoiceActivity({ kind: 'join', ...person })
      recordVoiceActivity({ kind: 'leave', ...person })
    }
    expect(voiceActivity.getSnapshot()).toHaveLength(MAX_VOICE_ACTIVITY)
  })

  it('tells its subscribers when something is recorded', () => {
    const seen = vi.fn()
    const stop = voiceActivity.subscribe(seen)
    recordVoiceActivity({ kind: 'join', ...AGER })
    expect(seen).toHaveBeenCalledTimes(1)

    // And not when nothing is.
    recordVoiceActivity({ kind: 'join', ...AGER })
    expect(seen).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('the sound', () => {
  it('plays for somebody else arriving and leaving', () => {
    recordVoiceActivity({ kind: 'join', ...AGER })
    expect(playVoiceCue).toHaveBeenCalledWith('join')

    recordVoiceActivity({ kind: 'leave', ...AGER })
    expect(playVoiceCue).toHaveBeenCalledWith('leave')
  })

  it('stays quiet for your own arrival', () => {
    recordVoiceActivity({ kind: 'join', ...ME })
    expect(playVoiceCue).not.toHaveBeenCalled()
  })

  it('stays quiet when the preference is off', () => {
    useVoiceStore.setState({ voiceActivitySoundsEnabled: false })
    recordVoiceActivity({ kind: 'join', ...AGER })
    expect(playVoiceCue).not.toHaveBeenCalled()
    // The event is still recorded: muting the chime is not muting the log.
    expect(voiceActivity.getSnapshot()).toHaveLength(1)
  })

  it('stays quiet for an event that was not recorded', () => {
    recordVoiceActivity({ kind: 'join', ...AGER })
    vi.mocked(playVoiceCue).mockClear()
    recordVoiceActivity({ kind: 'join', ...AGER })
    expect(playVoiceCue).not.toHaveBeenCalled()
  })
})
