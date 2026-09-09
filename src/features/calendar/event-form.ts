import { z } from 'zod'
import type { CalendarEventInput } from '@/services/calendar.service'
import { addDays, dayKeyOf, instantAt, type DayKey } from './calendar-time'

/**
 * What a person types, and what the database is given.
 *
 * A form cannot hold an instant: somebody picks a date, a clock time and a
 * zone, and the instant is what those three make together. Keeping them apart
 * until the last moment is what stops the browser's own zone leaking into an
 * event that was never meant in it — a scrim written as 20:00 Asia/Jakarta is
 * 20:00 there whoever is filling the form in.
 *
 * Every rule below also holds in Postgres. The lengths are the CHECK
 * constraints from 20250916004300, the types are its enumeration, the zone is
 * validated against `pg_timezone_names`, and `ends_at > starts_at` is a
 * constraint as well as a refinement. Bypassing this form gains nothing; it
 * exists so the refusal arrives in a sentence rather than as a round trip.
 */

/** The seven from the schema, and no others. */
export const EVENT_TYPES = [
  'match',
  'scrim',
  'practice',
  'meeting',
  'content',
  'event',
  'other',
] as const

/**
 * When to be reminded, as the form holds it.
 *
 * Strings because a `<Select>` deals in strings, and 'none' rather than an
 * empty value because an empty option in a Radix select is a placeholder
 * rather than a choice. The numbers are the set the database accepts —
 * `assert_valid_reminder` refuses anything else — so the two cannot drift.
 */
export const REMINDER_VALUES = ['none', '0', '5', '15', '30', '60', '1440'] as const

export type ReminderValue = (typeof REMINDER_VALUES)[number]

export const REMINDER_LABELS: Record<ReminderValue, string> = {
  none: 'No reminder',
  '0': 'At the time it starts',
  '5': '5 minutes before',
  '15': '15 minutes before',
  '30': '30 minutes before',
  '60': '1 hour before',
  '1440': '1 day before',
}

/** The minutes a stored reminder means, as the form's own value. */
export function reminderValueOf(minutes: number | null | undefined): ReminderValue {
  if (minutes === null || minutes === undefined) return 'none'
  const value = String(minutes)
  return (REMINDER_VALUES as readonly string[]).includes(value) ? (value as ReminderValue) : 'none'
}

/** And back again: what the service is given. */
export function reminderMinutesOf(value: ReminderValue): number | null {
  return value === 'none' ? null : Number(value)
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Whether this browser knows the zone.
 *
 * `Intl` throws on a name it does not recognise, and an exception inside a
 * validator is a blank form rather than a message. The database checks the
 * same thing against `pg_timezone_names`, which is the authority; this is so
 * the refusal arrives before the round trip.
 */
function isKnownZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export const eventFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'A title is required')
      .max(120, 'Keep the title under 120 characters'),
    eventType: z.enum(EVENT_TYPES),
    allDay: z.boolean(),
    startDate: z.string().regex(DAY_PATTERN, 'Pick a start date'),
    startTime: z.string().regex(TIME_PATTERN, 'Pick a start time'),
    endDate: z.string().regex(DAY_PATTERN, 'Pick an end date'),
    endTime: z.string().regex(TIME_PATTERN, 'Pick an end time'),
    timezone: z
      .string()
      .min(1, 'Pick a timezone')
      .refine(isKnownZone, 'That is not a timezone this browser knows'),
    reminder: z.enum(REMINDER_VALUES),
    location: z.string().trim().max(200, 'Keep the location under 200 characters'),
    description: z.string().trim().max(2000, 'Keep the description under 2000 characters'),
  })
  .superRefine((values, ctx) => {
    // A refinement runs even when a field above it failed, so nothing here may
    // assume a readable date, clock or zone: the field's own message is the
    // one worth showing, and comparing rubbish would only add noise.
    if (!DAY_PATTERN.test(values.startDate) || !DAY_PATTERN.test(values.endDate)) return
    if (!isKnownZone(values.timezone)) return

    if (values.allDay) {
      // A day range, so the comparison is between days rather than instants:
      // one all-day event may begin and end on the same date.
      if (values.endDate < values.startDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endDate'],
          message: 'The last day cannot be before the first',
        })
      }
      return
    }

    if (!TIME_PATTERN.test(values.startTime) || !TIME_PATTERN.test(values.endTime)) return

    // Timed: the instants the three fields make together, in the event's own
    // zone rather than the browser's.
    const starts = instantAt(values.startDate, values.timezone, ...clock(values.startTime))
    const ends = instantAt(values.endDate, values.timezone, ...clock(values.endTime))
    if (ends.getTime() <= starts.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'An event has to end after it starts',
      })
    }
  })

export type EventFormValues = z.infer<typeof eventFormSchema>

function clock(value: string): [number, number] {
  const [hour, minute] = value.split(':').map(Number)
  return [hour ?? 0, minute ?? 0]
}

/**
 * The form, as the service takes it.
 *
 * All-day events become local midnight to the following local midnight in the
 * event's own zone — the half-open range Phase 5.1 stores and the reason a
 * one-day event is exactly twenty-four hours in its own zone rather than in
 * UTC. The database normalises this again; sending it correctly means the two
 * never disagree about which day was meant.
 */
export function toEventInput(values: EventFormValues, organizationId: string): CalendarEventInput {
  const timed = !values.allDay
  const starts = timed
    ? instantAt(values.startDate, values.timezone, ...clock(values.startTime))
    : instantAt(values.startDate, values.timezone)
  const ends = timed
    ? instantAt(values.endDate, values.timezone, ...clock(values.endTime))
    : // Exclusive: the midnight after the last day the event covers.
      instantAt(addDays(values.endDate, 1), values.timezone)

  return {
    organizationId,
    title: values.title.trim(),
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
    allDay: values.allDay,
    timezone: values.timezone,
    eventType: values.eventType,
    location: values.location.trim() || null,
    description: values.description.trim() || null,
    reminderMinutes: reminderMinutesOf(values.reminder),
  }
}

/** Nine to ten, which is a meeting-shaped hour and needs no business logic. */
export const DEFAULT_START_TIME = '09:00'
export const DEFAULT_END_TIME = '10:00'

/**
 * The form a calendar opens with.
 *
 * The day is whichever one the calendar is looking at, so creating from a day
 * you navigated to schedules it there rather than today.
 */
export function defaultsFor(day: DayKey, timezone: string): EventFormValues {
  return {
    title: '',
    eventType: 'scrim',
    allDay: false,
    startDate: day,
    startTime: DEFAULT_START_TIME,
    endDate: day,
    endTime: DEFAULT_END_TIME,
    timezone,
    // Nothing is scheduled with a reminder unless somebody asks for one.
    reminder: 'none',
    location: '',
    description: '',
  }
}

/**
 * An event, back in the fields it was written in.
 *
 * In the event's OWN zone, not the reader's. A scrim stored as 20:00
 * Asia/Jakarta opens for editing in Berlin as 20:00 Asia/Jakarta — the hour
 * its author meant — rather than as 14:00 Europe/Berlin, which is the same
 * instant but a different sentence, and which would silently move the event
 * the moment somebody saved an unrelated change to the title.
 *
 * All-day events end exclusively in the database, so the last day shown is the
 * day before the stored end.
 */
export function defaultsFromEvent(event: {
  title: string
  eventType: EventFormValues['eventType']
  allDay: boolean
  startsAt: string
  endsAt: string
  timezone: string
  location: string | null
  description: string | null
  reminderMinutes?: number | null
}): EventFormValues {
  const zone = event.timezone
  const startDay = dayKeyOf(event.startsAt, zone)
  const endDay = event.allDay
    ? // The stored end is the midnight after the last day it covers.
      addDays(dayKeyOf(new Date(Date.parse(event.endsAt) - 1), zone), 0)
    : dayKeyOf(event.endsAt, zone)

  return {
    title: event.title,
    eventType: event.eventType,
    allDay: event.allDay,
    startDate: startDay,
    startTime: clockIn24(event.startsAt, zone),
    endDate: endDay,
    endTime: clockIn24(event.endsAt, zone),
    timezone: zone,
    reminder: reminderValueOf(event.reminderMinutes),
    location: event.location ?? '',
    description: event.description ?? '',
  }
}

/** "20:00" in a zone, in the shape an `<input type="time">` takes. */
function clockIn24(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(instant))
  // Midnight comes back as 24:00 in some engines' hour cycle.
  return parts.startsWith('24') ? `00${parts.slice(2)}` : parts
}

/** Today in a zone, for the form's own default when there is no anchor. */
export function todayIn(timezone: string, now: Date = new Date()): DayKey {
  return dayKeyOf(now, timezone)
}
