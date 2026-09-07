import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns'

/** "Tuesday, 4 September" — the dashboard's date line. */
export function formatLongDate(date: Date | string): string {
  return format(new Date(date), 'EEEE, d MMMM')
}

/** "14:32" for today, "Yesterday 14:32", otherwise "4 Sep, 14:32". */
export function formatTimestamp(value: Date | string): string {
  const date = new Date(value)
  if (isToday(date)) return format(date, 'HH:mm')
  if (isYesterday(date)) return `Yesterday ${format(date, 'HH:mm')}`
  return format(date, 'd MMM, HH:mm')
}

/** "22:41" — the time on its own, for a timeline's left column. */
export function formatClock(value: Date | string): string {
  return format(new Date(value), 'HH:mm')
}

/** "Today" / "Yesterday" / "4 Sep" — the rule between days in a timeline. */
export function formatDayLabel(value: Date | string): string {
  const date = new Date(value)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'd MMM')
}

/** "3 minutes ago" — for activity feeds. */
export function formatRelative(value: Date | string): string {
  return `${formatDistanceToNowStrict(new Date(value))} ago`
}

/** "in 6 days" / "expired" — for deadlines and expiry. */
export function formatTimeUntil(value: Date | string): string {
  const date = new Date(value)
  if (date.getTime() <= Date.now()) return 'expired'
  return `in ${formatDistanceToNowStrict(date)}`
}

/** "Joined 4 Sep 2025". */
export function formatDate(value: Date | string): string {
  return format(new Date(value), 'd MMM yyyy')
}

/** Time-of-day greeting, used once on the dashboard. */
export function greetingFor(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * IANA zones offered in the settings pickers. A short, curated list beats
 * shipping the full tz database for a six-person organization.
 */
export const COMMON_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Istanbul',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const

/** The browser's zone, when it is one we offer. */
export function detectTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone || 'UTC'
  } catch {
    return 'UTC'
  }
}
