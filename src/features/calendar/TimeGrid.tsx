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
import { placeOverlapping, type Placement } from './event-collisions'

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
 * Events are display-only here: nothing drags and nothing resizes. Events that
 * share an hour share the width of the day instead of being drawn on top of
 * each other, which they were until the arithmetic in `event-collisions` was
 * written — the grid answered "when" and nothing answered "where across".
 *
 * Each day is its own collision domain. Monday's busiest hour has no bearing
 * on how wide Tuesday's events are, which falls out of grouping by day before
 * laying anything out rather than being a rule anybody has to remember.
 */

/** Pixels per hour. Forty-eight is two lines of 11px mono and a border. */
const HOUR = 48
const HOURS = Array.from({ length: 24 }, (_, i) => i)

/**
 * The shortest an event is ever drawn, and therefore the shortest it can be
 * for the purpose of bumping into its neighbour.
 *
 * A fifteen-minute call would be a hairline at one pixel per minute, so the
 * grid has always given every event at least this much height. That means two
 * five-minute events ten minutes apart genuinely do collide on screen even
 * though their instants do not touch — so the collision is computed on the
 * interval as drawn, which is still an interval and still not a pixel.
 */
const MIN_HEIGHT = 18
const MIN_MINUTES = (MIN_HEIGHT / HOUR) * 60

/**
 * The breathing room between two events side by side, and between an event and
 * the edge of its day.
 *
 * Two pixels — the `0.5` step this grid was already using for exactly this,
 * back when every event was full width. Taken out of the width rather than
 * added to the offset, so a full row of events can never add up to more than
 * the column they are in.
 */
const GAP = 2

/**
 * The narrowest a day column is allowed to get.
 *
 * Seven days across a phone leaves about forty pixels each, and two events at
 * the same hour then get twenty — a sliver with no room for a word, which is
 * not a layout so much as an admission. The grid already sits in a horizontal
 * scroller; below this width it uses it, so a week on a phone is scrolled
 * rather than crushed, and nothing is hidden to make room.
 *
 * The day view has one column and never reaches this.
 */
const MIN_DAY_WIDTH = 96

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/**
 * Where an event sits on one particular day, in minutes from its midnight.
 *
 * Clamped to the day it is drawn in: an event that began yesterday starts at
 * the top of today's column rather than above it, which is what makes a
 * multi-day event readable in a week without a second layout pass. This is the
 * interval the collision arithmetic is given, so what shares space is what
 * actually appears on this day rather than what the row says in the abstract.
 */
function spanOnDay(event: CalendarEvent, day: DayKey, displayZone: string) {
  const from =
    dayKeyOf(event.startsAt, displayZone) === day ? minutesIntoDay(event.startsAt, displayZone) : 0
  // A millisecond back from an exclusive end is the moment it is still on.
  const lastMoment = new Date(Date.parse(event.endsAt) - 1)
  const until =
    dayKeyOf(lastMoment, displayZone) === day ? minutesIntoDay(event.endsAt, displayZone) : 24 * 60

  return { start: from, end: Math.max(until, from + MIN_MINUTES) }
}

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

  /**
   * Every timed event with somewhere to be, worked out once per render rather
   * than per event per hour cell. It is a handful of intervals and a sort, and
   * it is derived from the events — so it is a memo, not state: state would be
   * a second copy of something the query already knows.
   */
  const laidOut = useMemo(() => {
    const out = new Map<DayKey, { event: CalendarEvent; span: { start: number; end: number }; placement: Placement }[]>()

    for (const day of days) {
      const { timed } = splitDay(byDay.get(day) ?? [])
      const spans = timed.map((event) => spanOnDay(event, day, displayZone))
      const placements = placeOverlapping(spans)

      out.set(
        day,
        timed.map((event, index) => ({
          event,
          span: spans[index] as { start: number; end: number },
          placement: placements[index] as Placement,
        })),
      )
    }
    return out
  }, [byDay, days, displayZone])

  const columns = days.length
  // One template, three grids: the headers, the all-day strip and the hours
  // have to agree on where a day starts, and two copies of that would drift.
  const template = `44px repeat(${String(columns)}, minmax(${String(MIN_DAY_WIDTH)}px, 1fr))`

  return (
    // `min-w-max` rather than a fixed width: it fills the page when there is
    // room and grows past it when there is not, and the scroller it is already
    // wrapped in does the rest.
    <div className="border-border bg-card min-w-max overflow-hidden rounded-md border">
      {/* --- Day headers -------------------------------------------------- */}
      <div
        className="border-border-subtle grid border-b"
        style={{ gridTemplateColumns: template }}
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
        style={{ gridTemplateColumns: template }}
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
        style={{ gridTemplateColumns: template }}
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

        {days.map((day) => (
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

            {(laidOut.get(day) ?? []).map(({ event, span, placement }) => (
              <TimedEvent
                key={`${day}:${event.id}`}
                event={event}
                span={span}
                placement={placement}
                displayZone={displayZone}
                onOpen={onOpenEvent}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One event, placed by the clock and by who else is on at the time.
 *
 * The vertical half is arithmetic on minutes, as it always was. The horizontal
 * half is the fraction of the day the collision pass gave it, with the gap
 * taken out of the width rather than added to the offset — so a row of four
 * events adds up to the column they are in and never a pixel more.
 *
 * The card itself is unchanged: same border, same type mark, same two lines of
 * text, same truncation. Nothing here makes text smaller or hides an event to
 * make room; the room is made by the geometry.
 */
function TimedEvent({
  event,
  span,
  placement,
  displayZone,
  onOpen,
}: {
  event: CalendarEvent
  /** Minutes into this day, already clamped and floored to the minimum. */
  span: { start: number; end: number }
  placement: Placement
  displayZone: string
  onOpen: (event: CalendarEvent) => void
}) {
  const top = (span.start / 60) * HOUR
  const height = ((span.end - span.start) / 60) * HOUR

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      aria-label={`${event.title}, ${EVENT_TYPE_LABELS[event.eventType]}, ${clockIn(event.startsAt, displayZone)}`}
      className={cn(
        'border-border-subtle bg-elevated hover:border-border-strong absolute',
        'flex gap-1 overflow-hidden rounded-sm border px-1 py-0.5 text-left transition-colors duration-[120ms]',
      )}
      style={{
        top,
        height,
        left: `calc(${String(placement.left * 100)}% + ${String(GAP)}px)`,
        width: `calc(${String(placement.width * 100)}% - ${String(GAP * 2)}px)`,
      }}
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
