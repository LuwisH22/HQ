import { useMemo } from 'react'
import type { CalendarEvent } from '@/services/calendar.service'
import { cn } from '@/lib/utils'
import { groupByDay, splitDay } from './calendar-layout'
import {
  clockIn,
  dayKeyOf,
  dayNumber,
  minutesIntoDay,
  weekdayIndex,
  type DayKey,
} from './calendar-time'
import { EVENT_TYPE_LABELS, markFor } from './event-types'
import { EventRow } from './EventRow'

/**
 * The week and the day, which are the same grid with a different number of
 * columns.
 *
 * One pixel per minute at `--row`, which makes positioning arithmetic rather
 * than layout: an event starts at its minute and is as tall as it lasts. Only
 * the hours are rendered — twenty-four rules and a column per day — because a
 * six-person calendar has no need of virtualisation and every reason to stay
 * readable.
 *
 * Events are display-only here. Nothing drags, nothing resizes, and an event
 * that overlaps another simply sits beside it in the same column: laying out
 * collisions properly is a phase with a specification, not a guess.
 */

/** Pixels per hour. Forty-eight is two lines of 11px mono and a border. */
const HOUR = 48
const HOURS = Array.from({ length: 24 }, (_, i) => i)

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export function TimeGrid({
  days,
  today,
  events,
  displayZone,
  onOpenEvent,
}: {
  days: readonly DayKey[]
  today: DayKey
  events: readonly CalendarEvent[]
  displayZone: string
  onOpenEvent: (event: CalendarEvent) => void
}) {
  const byDay = useMemo(() => groupByDay(events, displayZone), [events, displayZone])
  const columns = days.length

  return (
    <div className="border-border bg-card overflow-hidden rounded-md border">
      {/* --- Day headers -------------------------------------------------- */}
      <div
        className="border-border-subtle grid border-b"
        style={{ gridTemplateColumns: `44px repeat(${String(columns)}, minmax(0, 1fr))` }}
      >
        <div aria-hidden="true" />
        {days.map((day) => (
          <div
            key={day}
            className={cn(
              'border-border-subtle border-l px-2 py-2',
              day === today && 'bg-surface-active/40',
            )}
          >
            <p className="display-eyebrow text-3xs text-muted-foreground">
              {WEEKDAY_LABELS[weekdayIndex(day)]}
            </p>
            <p
              className={cn(
                'text-2xs mt-0.5 font-mono tabular-nums',
                day === today ? 'text-accent-text font-semibold' : 'text-secondary-foreground',
              )}
            >
              {dayNumber(day)}
              {day === today ? <span className="ml-1 font-sans">· today</span> : null}
            </p>
          </div>
        ))}
      </div>

      {/* --- All day ------------------------------------------------------ */}
      <div
        className="border-border-subtle grid border-b"
        style={{ gridTemplateColumns: `44px repeat(${String(columns)}, minmax(0, 1fr))` }}
      >
        <div className="display-eyebrow text-3xs text-muted-foreground px-2 py-1.5">All</div>
        {days.map((day) => {
          const { allDay } = splitDay(byDay.get(day) ?? [])
          return (
            <div key={day} className="border-border-subtle min-h-8 border-l p-1">
              {allDay.map((event) => (
                <EventRow
                  key={`${day}:${event.id}`}
                  event={event}
                  displayZone={displayZone}
                  onOpen={onOpenEvent}
                  compact
                />
              ))}
            </div>
          )
        })}
      </div>

      {/* --- The hours ---------------------------------------------------- */}
      <div
        className="grid overflow-x-hidden"
        style={{ gridTemplateColumns: `44px repeat(${String(columns)}, minmax(0, 1fr))` }}
      >
        <div aria-hidden="true">
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="text-2xs text-muted-foreground border-border-subtle border-b px-2 pt-0.5 text-right font-mono tabular-nums"
              style={{ height: HOUR }}
            >
              {String(hour).padStart(2, '0')}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const { timed } = splitDay(byDay.get(day) ?? [])
          return (
            <div
              key={day}
              className={cn(
                'border-border-subtle relative border-l',
                day === today && 'bg-surface-active/20',
              )}
            >
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="border-border-subtle border-b"
                  style={{ height: HOUR }}
                  aria-hidden="true"
                />
              ))}

              {timed.map((event) => (
                <TimedEvent
                  key={`${day}:${event.id}`}
                  event={event}
                  day={day}
                  displayZone={displayZone}
                  onOpen={onOpenEvent}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One event, placed by the clock.
 *
 * Clamped to the day it is drawn in: an event that began yesterday starts at
 * the top of today's column rather than above it, which is what makes a
 * multi-day event readable in a week without a second layout pass.
 */
function TimedEvent({
  event,
  day,
  displayZone,
  onOpen,
}: {
  event: CalendarEvent
  day: DayKey
  displayZone: string
  onOpen: (event: CalendarEvent) => void
}) {
  // Where it begins on THIS day: its own minute if it started today, the top
  // of the column if it began before.
  const from =
    dayKeyOf(event.startsAt, displayZone) === day ? minutesIntoDay(event.startsAt, displayZone) : 0
  // And where it stops: its own minute if it ends today, the bottom if not.
  // A millisecond back from an exclusive end is the moment it is still on.
  const lastMoment = new Date(Date.parse(event.endsAt) - 1)
  const to =
    dayKeyOf(lastMoment, displayZone) === day ? minutesIntoDay(event.endsAt, displayZone) : 24 * 60

  const top = (from / 60) * HOUR
  // Never thinner than a line of text, or a fifteen-minute call is a hairline.
  const height = Math.max(18, ((to - from) / 60) * HOUR)

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      aria-label={`${event.title}, ${EVENT_TYPE_LABELS[event.eventType]}, ${clockIn(event.startsAt, displayZone)}`}
      className={cn(
        'border-border-subtle bg-elevated hover:border-border-strong absolute right-0.5 left-0.5',
        'flex gap-1 overflow-hidden rounded-sm border px-1 py-0.5 text-left transition-colors duration-[120ms]',
      )}
      style={{ top, height }}
    >
      <span
        aria-hidden="true"
        className={cn('w-0.5 shrink-0 rounded-full', markFor(event.eventType))}
      />
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-xs leading-tight font-medium">
          {event.title}
        </span>
        <span className="text-2xs text-muted-foreground block truncate font-mono">
          {clockIn(event.startsAt, displayZone)}
        </span>
      </span>
    </button>
  )
}
