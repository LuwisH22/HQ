import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '@/services/calendar.service'
import { daysCovered, groupByDay, splitDay } from './calendar-layout'

/**
 * Which cell an event lands in.
 *
 * The rule that matters is the difference between a timed event and an all-day
 * one: the first is an instant and belongs to whoever is reading it, the second
 * is a day and belongs to whoever wrote it. Getting that backwards is how an
 * all-day event slides onto the wrong date for half an organization, so it is
 * the first thing tested here.
 */

const JAKARTA = 'Asia/Jakarta'
const AUCKLAND = 'Pacific/Auckland'

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    organizationId: 'org-1',
    title: 'Scrim',
    description: null,
    location: null,
    // 20:00–22:00 in Jakarta.
    startsAt: '2026-03-01T13:00:00.000Z',
    endsAt: '2026-03-01T15:00:00.000Z',
    allDay: false,
    timezone: JAKARTA,
    eventType: 'scrim',
    createdBy: 'user-1',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('a timed event', () => {
  it('lands on the day the reader is having', () => {
    const scrim = event()
    expect(daysCovered(scrim, JAKARTA)).toEqual(['2026-03-01'])
    // The same instant is already the 2nd in Auckland.
    expect(daysCovered(scrim, AUCKLAND)).toEqual(['2026-03-02'])
  })

  it('appears on both days when it crosses midnight', () => {
    // 23:00 to 01:00 in Jakarta.
    const late = event({
      startsAt: '2026-03-01T16:00:00.000Z',
      endsAt: '2026-03-01T18:00:00.000Z',
    })
    expect(daysCovered(late, JAKARTA)).toEqual(['2026-03-01', '2026-03-02'])
  })

  it('does not spill onto the next day when it ends exactly at midnight', () => {
    // 22:00 to midnight in Jakarta: the day it ends on is still the 1st.
    const untilMidnight = event({
      startsAt: '2026-03-01T15:00:00.000Z',
      endsAt: '2026-03-01T17:00:00.000Z',
    })
    expect(daysCovered(untilMidnight, JAKARTA)).toEqual(['2026-03-01'])
  })
})

describe('an all-day event', () => {
  // Midnight to midnight in Jakarta, which is 17:00 UTC the days before.
  const bootcamp = event({
    allDay: true,
    startsAt: '2026-03-04T17:00:00.000Z',
    endsAt: '2026-03-05T17:00:00.000Z',
    timezone: JAKARTA,
    title: 'Bootcamp',
  })

  it('is the day its author meant, wherever it is read', () => {
    expect(daysCovered(bootcamp, JAKARTA)).toEqual(['2026-03-05'])
    // And it is still the 5th to a reader in Auckland, rather than sliding
    // onto the 6th because their midnight is somewhere else.
    expect(daysCovered(bootcamp, AUCKLAND)).toEqual(['2026-03-05'])
    expect(daysCovered(bootcamp, 'UTC')).toEqual(['2026-03-05'])
  })

  it('covers each of its days when it spans several', () => {
    const week = event({
      allDay: true,
      startsAt: '2026-03-04T17:00:00.000Z',
      endsAt: '2026-03-07T17:00:00.000Z',
      timezone: JAKARTA,
    })
    expect(daysCovered(week, 'UTC')).toEqual(['2026-03-05', '2026-03-06', '2026-03-07'])
  })
})

describe('grouping a month', () => {
  it('files every event under every day it touches', () => {
    const scrim = event({ id: 'a' })
    const overnight = event({
      id: 'b',
      startsAt: '2026-03-01T16:00:00.000Z',
      endsAt: '2026-03-01T18:00:00.000Z',
    })
    const byDay = groupByDay([scrim, overnight], JAKARTA)

    expect(byDay.get('2026-03-01')?.map((e) => e.id)).toEqual(['a', 'b'])
    expect(byDay.get('2026-03-02')?.map((e) => e.id)).toEqual(['b'])
    expect(byDay.get('2026-03-03')).toBeUndefined()
  })

  it('puts all-day events first and then orders by the clock', () => {
    const late = event({ id: 'late', startsAt: '2026-03-01T14:00:00.000Z' })
    const early = event({
      id: 'early',
      startsAt: '2026-03-01T02:00:00.000Z',
      endsAt: '2026-03-01T03:00:00.000Z',
    })
    const allDay = event({
      id: 'allday',
      allDay: true,
      startsAt: '2026-02-28T17:00:00.000Z',
      endsAt: '2026-03-01T17:00:00.000Z',
    })

    const byDay = groupByDay([late, early, allDay], JAKARTA)
    expect(byDay.get('2026-03-01')?.map((e) => e.id)).toEqual(['allday', 'early', 'late'])
  })
})

describe('a day column', () => {
  it('separates what has a time from what does not', () => {
    const timed = event({ id: 'timed' })
    const allDay = event({ id: 'allday', allDay: true })
    const { allDay: top, timed: grid } = splitDay([allDay, timed])

    expect(top.map((e) => e.id)).toEqual(['allday'])
    expect(grid.map((e) => e.id)).toEqual(['timed'])
  })
})
