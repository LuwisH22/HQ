import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  allDayLength,
  clockIn,
  dayKeyOf,
  dayNumber,
  durationLabel,
  instantAt,
  minutesIntoDay,
  monthGridDays,
  monthTitle,
  rangeForDays,
  startOfDayInstant,
  startOfMonth,
  startOfWeek,
  todayKey,
  weekDays,
  weekdayIndex,
  weekTitle,
} from './calendar-time'

/**
 * A day is a local idea, and this is the file that says so.
 *
 * Everything here is about the two conversions a calendar cannot get wrong:
 * which day an instant falls on somewhere, and which instant a day begins at
 * somewhere. The awkward cases — a zone thirteen hours from another, a clock
 * that jumps in spring, a month with thirty-one days followed by one with
 * twenty-eight — are the tests, because they are what a naive `new Date()`
 * gets wrong.
 */

const JAKARTA = 'Asia/Jakarta' // UTC+7, no DST
const BERLIN = 'Europe/Berlin' // UTC+1 / +2
const AUCKLAND = 'Pacific/Auckland' // UTC+12 / +13

describe('which day an instant falls on', () => {
  it('depends on where you are reading it', () => {
    // 20:00 on the 1st in Jakarta is 14:00 on the 1st in Berlin...
    const instant = '2026-03-01T13:00:00.000Z'
    expect(dayKeyOf(instant, JAKARTA)).toBe('2026-03-01')
    expect(dayKeyOf(instant, BERLIN)).toBe('2026-03-01')

    // ...but a late scrim in Jakarta is already tomorrow in Auckland.
    const late = '2026-03-01T16:30:00.000Z' // 23:30 Jakarta
    expect(dayKeyOf(late, JAKARTA)).toBe('2026-03-01')
    expect(dayKeyOf(late, AUCKLAND)).toBe('2026-03-02')
  })

  it('puts midnight on the day it opens, not the one it closes', () => {
    expect(dayKeyOf(startOfDayInstant('2026-03-05', JAKARTA), JAKARTA)).toBe('2026-03-05')
    expect(dayKeyOf(startOfDayInstant('2026-03-05', AUCKLAND), AUCKLAND)).toBe('2026-03-05')
  })
})

describe('which instant a day begins at', () => {
  it('is the zone offset away from UTC midnight', () => {
    // Jakarta is seven hours ahead, so its midnight is 17:00 the day before.
    expect(startOfDayInstant('2026-03-05', JAKARTA).toISOString()).toBe('2026-03-04T17:00:00.000Z')
    expect(startOfDayInstant('2026-03-05', 'UTC').toISOString()).toBe('2026-03-05T00:00:00.000Z')
  })

  it('gets the day a clock changes right', () => {
    // Europe/Berlin springs forward at 02:00 on 29 March 2026: the day still
    // begins at 00:00 local, which is 23:00 UTC on the 28th.
    expect(startOfDayInstant('2026-03-29', BERLIN).toISOString()).toBe('2026-03-28T23:00:00.000Z')
    // And the day after the change is an hour earlier in UTC terms.
    expect(startOfDayInstant('2026-03-30', BERLIN).toISOString()).toBe('2026-03-29T22:00:00.000Z')
  })

  it('round-trips a wall clock through a zone', () => {
    // 20:00 in Jakarta, whatever the browser thinks the time is.
    const instant = instantAt('2026-03-01', JAKARTA, 20, 0)
    expect(instant.toISOString()).toBe('2026-03-01T13:00:00.000Z')
    expect(clockIn(instant, JAKARTA)).toBe('20:00')
    expect(clockIn(instant, 'UTC')).toBe('13:00')
  })
})

describe('walking the calendar', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('adds months without rolling over a short one', () => {
    // A month after 31 January is February, not 3 March.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-03-15', 1)).toBe('2026-04-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })

  it('starts the week on Monday', () => {
    // 2026-03-01 is a Sunday.
    expect(weekdayIndex('2026-03-01')).toBe(6)
    expect(startOfWeek('2026-03-01')).toBe('2026-02-23')
    expect(startOfWeek('2026-03-02')).toBe('2026-03-02')
    expect(weekDays('2026-03-04')).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ])
  })

  it('starts the month on the first', () => {
    expect(startOfMonth('2026-03-17')).toBe('2026-03-01')
  })
})

describe('the month grid', () => {
  it('is always six weeks, whatever the month', () => {
    for (const month of ['2026-02-01', '2026-03-01', '2026-08-01', '2027-02-01']) {
      expect(monthGridDays(month)).toHaveLength(42)
    }
  })

  it('begins on the Monday on or before the first', () => {
    const grid = monthGridDays('2026-03-01')
    expect(grid[0]).toBe('2026-02-23')
    expect(grid).toContain('2026-03-01')
    expect(grid).toContain('2026-03-31')
    expect(grid[41]).toBe('2026-04-05')
  })

  it('numbers the cells by their own day', () => {
    expect(dayNumber('2026-03-05')).toBe('5')
    expect(dayNumber('2026-03-31')).toBe('31')
  })
})

describe('the window a view asks for', () => {
  it('is midnight to midnight around exactly what is on screen', () => {
    const range = rangeForDays(weekDays('2026-03-04'), JAKARTA)
    // The week begins on Monday the 2nd at local midnight...
    expect(range.from.toISOString()).toBe('2026-03-01T17:00:00.000Z')
    // ...and ends at midnight after Sunday the 8th, exclusive.
    expect(range.to.toISOString()).toBe('2026-03-08T17:00:00.000Z')
  })

  it('is one day wide for the day view', () => {
    const range = rangeForDays(['2026-03-05'], 'UTC')
    expect(range.from.toISOString()).toBe('2026-03-05T00:00:00.000Z')
    expect(range.to.toISOString()).toBe('2026-03-06T00:00:00.000Z')
  })

  it('covers the whole month grid, leading and trailing days included', () => {
    const range = rangeForDays(monthGridDays('2026-03-01'), 'UTC')
    expect(range.from.toISOString()).toBe('2026-02-23T00:00:00.000Z')
    expect(range.to.toISOString()).toBe('2026-04-06T00:00:00.000Z')
    // Six weeks and a day, which is what forty-two days is.
    const days = (range.to.getTime() - range.from.getTime()) / 86_400_000
    expect(days).toBe(42)
  })
})

describe('titles', () => {
  it('names the month and the year', () => {
    expect(monthTitle('2026-03-15', 'UTC')).toBe('March 2026')
  })

  it('names a week that stays in one month, and one that does not', () => {
    expect(weekTitle('2026-03-04', 'UTC')).toBe('2 – 8 Mar 2026')
    expect(weekTitle('2026-03-01', 'UTC')).toBe('23 Feb – 1 Mar 2026')
  })
})

describe('the clock', () => {
  it('reads an instant in the zone it is asked for', () => {
    expect(clockIn('2026-03-01T13:00:00.000Z', JAKARTA)).toBe('20:00')
    expect(clockIn('2026-03-01T13:00:00.000Z', BERLIN)).toBe('14:00')
  })

  it('measures into the day in that zone too', () => {
    expect(minutesIntoDay('2026-03-01T13:00:00.000Z', JAKARTA)).toBe(20 * 60)
    expect(minutesIntoDay('2026-03-01T13:00:00.000Z', 'UTC')).toBe(13 * 60)
  })

  it('says how long something is', () => {
    expect(durationLabel('2026-03-01T13:00:00Z', '2026-03-01T14:30:00Z')).toBe('1h 30m')
    expect(durationLabel('2026-03-01T13:00:00Z', '2026-03-01T14:00:00Z')).toBe('1h')
    expect(durationLabel('2026-03-01T13:00:00Z', '2026-03-01T13:45:00Z')).toBe('45m')
  })

  it('counts all-day events in whole days, end exclusive', () => {
    expect(allDayLength('2026-03-04T17:00:00Z', '2026-03-05T17:00:00Z')).toBe(1)
    expect(allDayLength('2026-03-04T17:00:00Z', '2026-03-07T17:00:00Z')).toBe(3)
  })
})

describe('today', () => {
  it('is whatever day it is where the reader is', () => {
    const instant = new Date('2026-03-01T16:30:00.000Z')
    expect(todayKey(JAKARTA, instant)).toBe('2026-03-01')
    expect(todayKey(AUCKLAND, instant)).toBe('2026-03-02')
  })
})
