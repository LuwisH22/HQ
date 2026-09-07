import type { CalendarEventType } from '@/types/database.types'

/**
 * How the seven categories are written and drawn.
 *
 * They are categories and nothing else — no policy, routine or check reads
 * them — so they get typography rather than seven colours. The accent marks
 * the two kinds of event that are somebody else's deadline, competition and
 * scrims; everything else is a neutral tick. Seven loud colours would make a
 * month grid look like a spreadsheet with conditional formatting.
 */
export const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  match: 'Match',
  scrim: 'Scrim',
  practice: 'Practice',
  meeting: 'Meeting',
  content: 'Content',
  event: 'Event',
  other: 'Other',
}

/**
 * The 2px mark at the head of an event row.
 *
 * `accent` for the two that are a fixture against another team, `brass` for a
 * match, which is the one thing on the calendar an organization is judged by,
 * and the quietest border for the rest. Three tones, all of them tokens that
 * already exist.
 */
export function markFor(type: CalendarEventType): string {
  if (type === 'match') return 'bg-brass'
  if (type === 'scrim') return 'bg-accent-text'
  return 'bg-border-strong'
}
