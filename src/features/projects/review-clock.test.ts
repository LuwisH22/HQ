import { describe, expect, it } from 'vitest'
import { deadlinePassed, remainingLabel } from './review-clock'

/**
 * What a person is told while a review runs.
 *
 * The deadline itself is a column on the project, written by the server and
 * re-read by the routine that completes it — so nothing here can let a
 * completion happen early. What it can do is say something wrong, or say
 * "0 minutes" for a whole minute, which is why the boundaries are the tests.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('how long is left', () => {
  it('counts days, then hours, then minutes', () => {
    expect(remainingLabel(3 * DAY)).toBe('3 days')
    expect(remainingLabel(5 * HOUR)).toBe('5 hours')
    expect(remainingLabel(14 * MINUTE)).toBe('14 minutes')
  })

  it('says one of a thing without an s', () => {
    expect(remainingLabel(DAY)).toBe('1 day')
    expect(remainingLabel(HOUR)).toBe('1 hour')
    expect(remainingLabel(MINUTE)).toBe('1 minute')
  })

  it('never says nothing is left while something is', () => {
    // The last minute reads as a minute rather than as "0 minutes", which
    // would look like the deadline had already passed when it had not.
    expect(remainingLabel(59_999)).toBe('under a minute')
    expect(remainingLabel(1)).toBe('under a minute')
  })

  it('rounds down, so it never promises more time than there is', () => {
    expect(remainingLabel(DAY + 23 * HOUR)).toBe('1 day')
    expect(remainingLabel(HOUR + 59 * MINUTE)).toBe('1 hour')
  })
})

describe('whether the review is over', () => {
  const now = Date.parse('2026-09-09T12:00:00.000Z')

  it('is not over while the deadline is ahead', () => {
    expect(deadlinePassed('2026-09-09T12:00:01.000Z', now)).toBe(false)
    expect(deadlinePassed('2026-09-10T12:00:00.000Z', now)).toBe(false)
  })

  it('is over at the deadline and after it', () => {
    expect(deadlinePassed('2026-09-09T12:00:00.000Z', now)).toBe(true)
    expect(deadlinePassed('2026-09-09T11:59:59.000Z', now)).toBe(true)
  })

  it('is over when there is no deadline at all', () => {
    // "No limit" means nothing to wait for, which is what the routine does
    // too: it only refuses a completion when a deadline exists and is ahead.
    expect(deadlinePassed(null, now)).toBe(true)
  })

  it('is not over when the timestamp cannot be read', () => {
    // A row that cannot be parsed is not a licence to finish early. The
    // routine would refuse anyway; this refuses to draw the button.
    expect(deadlinePassed('not a date', now)).toBe(false)
  })
})
