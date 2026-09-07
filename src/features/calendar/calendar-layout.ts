import type { CalendarEvent } from '@/services/calendar.service'
import { addDays, dayKeyOf, type DayKey } from './calendar-time'

/**
 * Which day does an event belong on.
 *
 * Two rules, and the difference between them is the whole of "all-day":
 *
 *   A timed event is an instant, so which day it lands on depends on where the
 *   reader is. A scrim at 23:30 in Jakarta is already tomorrow in Sydney, and
 *   the calendar has to agree with the clock on the wall of whoever is reading
 *   it. Timed events are placed in the display zone.
 *
 *   An all-day event is not an instant at all — it is a day, written in the
 *   zone its author meant. "The bootcamp is on the 5th" is the 5th in Jakarta
 *   whoever reads it, so an all-day event is placed in its OWN zone. Doing it
 *   the other way is how an all-day event slides onto the 4th for half the
 *   organization, or turns into a 00:00 timed event, which §9 asks it not to.
 *
 * The end of an all-day event is exclusive, as the database stores it: an
 * event ending at midnight on the 6th is over on the 5th.
 */

/** The days an event occupies, in the order a grid would draw them. */
export function daysCovered(event: CalendarEvent, displayZone: string): DayKey[] {
  const zone = event.allDay ? event.timezone : displayZone
  const first = dayKeyOf(event.startsAt, zone)

  // A millisecond back from an exclusive end is the last day it is really on.
  // For a timed event this is the day it finishes; for an all-day event it is
  // the last whole day.
  const lastInstant = new Date(Date.parse(event.endsAt) - 1)
  const last = dayKeyOf(
    // An end at or before the start is not a range; the database refuses one,
    // and this refuses to draw one.
    Date.parse(event.endsAt) > Date.parse(event.startsAt) ? lastInstant : new Date(event.startsAt),
    zone,
  )

  const days: DayKey[] = [first]
  // Bounded so a malformed row cannot spin: nothing sensible spans a year.
  for (let day = addDays(first, 1), i = 0; day <= last && i < 400; day = addDays(day, 1), i += 1) {
    days.push(day)
  }
  return days
}

/**
 * Every event, filed under every day it touches.
 *
 * A Map rather than a search per cell: a month is forty-two cells, and asking
 * each of them to scan the whole event list is the one part of a calendar that
 * gets slow for no reason.
 */
export function groupByDay(
  events: readonly CalendarEvent[],
  displayZone: string,
): Map<DayKey, CalendarEvent[]> {
  const byDay = new Map<DayKey, CalendarEvent[]>()

  for (const event of events) {
    for (const day of daysCovered(event, displayZone)) {
      const bucket = byDay.get(day)
      if (bucket) bucket.push(event)
      else byDay.set(day, [event])
    }
  }

  // All-day first, then by when they start: the order a day is read in.
  for (const bucket of byDay.values()) bucket.sort(compareForDay)
  return byDay
}

export function compareForDay(a: CalendarEvent, b: CalendarEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  const byStart = Date.parse(a.startsAt) - Date.parse(b.startsAt)
  if (byStart !== 0) return byStart
  return a.title.localeCompare(b.title)
}

/** What a day's column holds, split the way week and day views draw it. */
export function splitDay(events: readonly CalendarEvent[]): {
  allDay: CalendarEvent[]
  timed: CalendarEvent[]
} {
  return {
    allDay: events.filter((event) => event.allDay),
    timed: events.filter((event) => !event.allDay),
  }
}
