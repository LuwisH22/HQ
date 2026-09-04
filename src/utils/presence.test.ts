import { describe, expect, it } from 'vitest'
import { presenceFrom, presenceLabel } from './presence'

const NOW = new Date('2025-09-04T12:00:00Z').getTime()
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

describe('presenceFrom', () => {
  it('is online within the last five minutes', () => {
    expect(presenceFrom(minutesAgo(0), NOW)).toBe('online')
    expect(presenceFrom(minutesAgo(4), NOW)).toBe('online')
    expect(presenceFrom(minutesAgo(5), NOW)).toBe('online')
  })

  it('is away between five and thirty minutes', () => {
    expect(presenceFrom(minutesAgo(6), NOW)).toBe('away')
    expect(presenceFrom(minutesAgo(30), NOW)).toBe('away')
  })

  it('is offline beyond thirty minutes', () => {
    expect(presenceFrom(minutesAgo(31), NOW)).toBe('offline')
    expect(presenceFrom(minutesAgo(60 * 24), NOW)).toBe('offline')
  })

  it('treats a missing or unparseable timestamp as offline', () => {
    expect(presenceFrom(null, NOW)).toBe('offline')
    expect(presenceFrom(undefined, NOW)).toBe('offline')
    expect(presenceFrom('not a date', NOW)).toBe('offline')
  })

  it('does not report a future timestamp as offline', () => {
    expect(presenceFrom(minutesAgo(-5), NOW)).toBe('online')
  })
})

describe('presenceLabel', () => {
  it('labels every state', () => {
    expect(presenceLabel('online')).toBe('Online')
    expect(presenceLabel('away')).toBe('Away')
    expect(presenceLabel('offline')).toBe('Offline')
  })
})
