import { describe, expect, it } from 'vitest'
import { effectiveMemberStatus, isEffectivelyActive, suspensionEndsAt } from './moderation'

/**
 * These mirror `is_effectively_active()` in Postgres, which is the authority.
 * If the two ever disagree the interface will label someone incorrectly, so
 * the edge cases are pinned here rather than left to inference.
 */

const NOW = new Date('2026-09-10T12:00:00Z')
const PAST = '2026-09-09T12:00:00Z'
const FUTURE = '2026-09-11T12:00:00Z'

describe('effectiveMemberStatus', () => {
  it('leaves an active member active', () => {
    expect(effectiveMemberStatus('active', null, NOW)).toBe('active')
  })

  it('keeps a suspension in force before its expiry', () => {
    expect(effectiveMemberStatus('suspended', FUTURE, NOW)).toBe('suspended')
  })

  it('restores access once the expiry has passed, with nothing written', () => {
    // This is the whole point of deriving rather than scheduling: no cron job
    // runs, the row still says 'suspended', and access is back.
    expect(effectiveMemberStatus('suspended', PAST, NOW)).toBe('active')
  })

  it('treats the exact expiry instant as lapsed', () => {
    expect(effectiveMemberStatus('suspended', NOW.toISOString(), NOW)).toBe('active')
  })

  it('treats a suspension with no expiry as indefinite', () => {
    expect(effectiveMemberStatus('suspended', null, NOW)).toBe('suspended')
  })

  it('never lets a ban lapse, whatever the timestamp says', () => {
    // A stale suspended_until must not become an accidental unban.
    expect(effectiveMemberStatus('banned', PAST, NOW)).toBe('banned')
    expect(effectiveMemberStatus('banned', FUTURE, NOW)).toBe('banned')
    expect(effectiveMemberStatus('banned', null, NOW)).toBe('banned')
  })

  it('fails closed on an unparseable timestamp', () => {
    expect(effectiveMemberStatus('suspended', 'not-a-date', NOW)).toBe('suspended')
  })
})

describe('isEffectivelyActive', () => {
  it('agrees with effectiveMemberStatus', () => {
    expect(isEffectivelyActive('active', null, NOW)).toBe(true)
    expect(isEffectivelyActive('suspended', PAST, NOW)).toBe(true)
    expect(isEffectivelyActive('suspended', FUTURE, NOW)).toBe(false)
    expect(isEffectivelyActive('suspended', null, NOW)).toBe(false)
    expect(isEffectivelyActive('banned', null, NOW)).toBe(false)
  })
})

describe('suspensionEndsAt', () => {
  it('reports the expiry only while the suspension is in force', () => {
    expect(suspensionEndsAt('suspended', FUTURE, NOW)?.getTime()).toBe(Date.parse(FUTURE))
  })

  it('reports nothing once the suspension has lapsed', () => {
    expect(suspensionEndsAt('suspended', PAST, NOW)).toBeNull()
  })

  it('reports nothing for an indefinite suspension', () => {
    expect(suspensionEndsAt('suspended', null, NOW)).toBeNull()
  })

  it('reports nothing for a ban — there is no end date to show', () => {
    expect(suspensionEndsAt('banned', FUTURE, NOW)).toBeNull()
  })
})
