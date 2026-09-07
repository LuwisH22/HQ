/**
 * Days, in a zone that is not necessarily this browser's.
 *
 * A calendar is a grid of days, and a day is a local idea: "5 March" is a
 * different pair of instants in Jakarta and in Berlin. The database stores
 * instants, so every question this file answers — which cell does this event
 * belong in, which instant does this grid begin at — has to name a zone.
 *
 * There is no timezone library here on purpose. `Intl.DateTimeFormat` already
 * ships the whole tz database in every browser this application supports, and
 * the two operations a calendar needs are small:
 *
 *   instant → day in a zone      formatting, which Intl does directly
 *   day in a zone → instant      a guess and a correction, below
 *
 * `date-fns` still does the arithmetic that has no zone in it — adding months,
 * walking a week — on the day keys rather than on instants.
 */

/** A calendar day, as `YYYY-MM-DD`. Never an instant, never a Date. */
export type DayKey = string

/** Both ends of a window, as instants. The upper bound is exclusive. */
export interface InstantRange {
  from: Date
  to: Date
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * `en-CA` because it formats as `2026-03-05` and nothing else does so
 * reliably. The parts are read individually rather than trusting the joined
 * string, which is the part that survives a locale surprise.
 */
function partsIn(instant: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant)

  const out: Record<string, number> = {}
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = Number(part.value)
  }
  // Midnight comes back as hour 24 in some engines' `hourCycle`.
  if (out.hour === 24) out.hour = 0
  return out
}

/** How far ahead of UTC the zone is at that instant, in minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone)
  const asUtc = Date.UTC(
    p.year ?? 1970,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  )
  return (asUtc - instant.getTime()) / 60_000
}

/** The day an instant falls on, in that zone. */
export function dayKeyOf(instant: Date | string, timeZone: string): DayKey {
  const p = partsIn(new Date(instant), timeZone)
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** The parts of a day key, as numbers. */
function splitKey(key: DayKey): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number)
  return [y ?? 1970, m ?? 1, d ?? 1]
}

/**
 * The instant a wall clock names in a zone.
 *
 * Guess that the wall clock is UTC, ask the zone what its offset was near that
 * moment, correct, and check once more — the second pass is what gets the
 * hours around a DST change right, where the first guess can land on the wrong
 * side of the transition.
 */
export function instantAt(key: DayKey, timeZone: string, hour = 0, minute = 0): Date {
  const [year, month, day] = splitKey(key)
  const wall = Date.UTC(year, month - 1, day, hour, minute)

  let instant = new Date(wall - offsetMinutes(new Date(wall), timeZone) * 60_000)
  instant = new Date(wall - offsetMinutes(instant, timeZone) * 60_000)
  return instant
}

/** Local midnight, which is where a day begins. */
export function startOfDayInstant(key: DayKey, timeZone: string): Date {
  return instantAt(key, timeZone, 0, 0)
}

/** Day keys move by whole days, whatever the clocks did in between. */
export function addDays(key: DayKey, days: number): DayKey {
  const [year, month, day] = splitKey(key)
  const moved = new Date(Date.UTC(year, month - 1, day + days))
  return moved.toISOString().slice(0, 10)
}

export function addMonths(key: DayKey, months: number): DayKey {
  const [year, month, day] = splitKey(key)
  // Clamped rather than rolled over: a month after 31 January is 28 February,
  // not 3 March, because the calendar's title has to stay believable.
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  return `${String(target.getUTCFullYear()).padStart(4, '0')}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

/** 0 = Monday … 6 = Sunday. The week starts on Monday, as the grid does. */
export function weekdayIndex(key: DayKey): number {
  const [year, month, day] = splitKey(key)
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

export function startOfWeek(key: DayKey): DayKey {
  return addDays(key, -weekdayIndex(key))
}

export function startOfMonth(key: DayKey): DayKey {
  const [year, month] = splitKey(key)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
}

export function monthOf(key: DayKey): string {
  return key.slice(0, 7)
}

/** Today, in the zone the calendar is being read in. */
export function todayKey(timeZone: string, now: Date = new Date()): DayKey {
  return dayKeyOf(now, timeZone)
}

/**
 * The six weeks a month grid draws.
 *
 * Always six, so switching months never changes the grid's height and the
 * page never jumps. The leading and trailing days belong to the neighbouring
 * months and are drawn quieter.
 */
export function monthGridDays(key: DayKey): DayKey[] {
  const first = startOfWeek(startOfMonth(key))
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}

export function weekDays(key: DayKey): DayKey[] {
  const first = startOfWeek(key)
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

/**
 * The instants a set of days spans, for the query.
 *
 * From local midnight on the first day to local midnight after the last, so a
 * request asks for exactly what is on screen and nothing else.
 */
export function rangeForDays(days: readonly DayKey[], timeZone: string): InstantRange {
  const first = days[0] ?? todayKey(timeZone)
  const last = days[days.length - 1] ?? first
  return {
    from: startOfDayInstant(first, timeZone),
    to: startOfDayInstant(addDays(last, 1), timeZone),
  }
}

/** "March 2026" — the month view's title. */
export function monthTitle(key: DayKey, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    month: 'long',
    year: 'numeric',
  }).format(startOfDayInstant(key, timeZone))
}

/** "2 – 8 March 2026" — the week view's title. */
export function weekTitle(key: DayKey, timeZone: string): string {
  const days = weekDays(key)
  const first = days[0] as DayKey
  const last = days[6] as DayKey
  const sameMonth = monthOf(first) === monthOf(last)

  const day = (k: DayKey, withMonth: boolean) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      ...(withMonth ? { month: 'short' } : {}),
    }).format(startOfDayInstant(k, timeZone))

  const year = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }).format(
    startOfDayInstant(last, timeZone),
  )
  return `${day(first, !sameMonth)} – ${day(last, true)} ${year}`
}

/** "Thursday, 5 March 2026" — the day view's title. */
export function dayTitle(key: DayKey, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(startOfDayInstant(key, timeZone))
}

/** The number in a month cell. */
export function dayNumber(key: DayKey): string {
  return String(splitKey(key)[2])
}

/** "20:00" in a named zone, which is not necessarily this browser's. */
export function clockIn(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(instant))
}

/** Minutes since local midnight, which is where a timeline puts something. */
export function minutesIntoDay(instant: Date | string, timeZone: string): number {
  const p = partsIn(new Date(instant), timeZone)
  return (p.hour ?? 0) * 60 + (p.minute ?? 0)
}

/** How long, as "1h 30m" — mono metadata, never a sentence. */
export function durationLabel(startsAt: string, endsAt: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${String(rest)}m`
  if (rest === 0) return `${String(hours)}h`
  return `${String(hours)}h ${String(rest)}m`
}

/** Whole days, for an all-day event whose end is exclusive. */
export function allDayLength(startsAt: string, endsAt: string): number {
  return Math.max(1, Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / DAY_MS))
}
