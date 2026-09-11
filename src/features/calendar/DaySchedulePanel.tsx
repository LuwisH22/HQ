import { m } from 'motion/react'
import { MapPin } from '@phosphor-icons/react'
import type { CalendarEvent } from '@/services/calendar.service'
import { cn } from '@/lib/utils'
import { allDayLength, clockIn, durationLabel, type DayKey } from './calendar-time'
import { layoutTransition, rowEntrance } from './calendar-motion'
import { EVENT_TYPE_LABELS, markFor } from './event-types'
import type { RowFlash } from './EventRow'
import type { Origin } from './calendar-workspace-state'

/**
 * The selected day, as a rundown.
 *
 * The panel's resting content: what is on, in the order it happens, with the
 * hour down the left and a rail the rows hang from. Each row is the same
 * shape as its twin in the grid — mark, title, time — plus the one thing a
 * cell has no room for, the place.
 *
 * Rows arrive with a stagger of sixteen milliseconds and never more than six
 * of them, so a day appears as a continuity rather than a list snapping in;
 * a row that appears later — somebody else scheduling something — enters the
 * same way and the rows below it move down rather than jump.
 */
export function DaySchedulePanel({
  day,
  events,
  displayZone,
  currentEventId,
  highlight,
  flashes,
  reducedMotion,
  onOpenEvent,
  onHighlight,
}: {
  day: DayKey
  events: readonly CalendarEvent[]
  displayZone: string
  currentEventId: string | null
  highlight: string | null
  flashes: ReadonlyMap<string, RowFlash>
  reducedMotion: boolean
  onOpenEvent: (event: CalendarEvent, from: Origin) => void
  onHighlight: (eventId: string | null) => void
}) {
  if (events.length === 0) {
    return (
      <div className="grid grid-cols-[44px_1fr] gap-x-3">
        <span className="text-2xs text-muted-foreground pt-2 font-mono" aria-hidden="true">
          —
        </span>
        <p className="border-border-subtle text-muted-foreground border-l py-2 pl-3 text-sm">
          Nothing scheduled.
        </p>
      </div>
    )
  }

  return (
    // Keyed by the day so a new day is a new list and the stagger runs again.
    <ul key={day} className="m-0 list-none p-0" aria-label="Schedule">
      {events.map((event, index) => {
        const zone = event.allDay ? event.timezone : displayZone
        const time = event.allDay ? 'All day' : clockIn(event.startsAt, zone)
        const range = event.allDay
          ? allDayLength(event.startsAt, event.endsAt) === 1
            ? 'Whole day'
            : `${String(allDayLength(event.startsAt, event.endsAt))} days`
          : `${clockIn(event.startsAt, displayZone)} – ${clockIn(event.endsAt, displayZone)} · ${durationLabel(event.startsAt, event.endsAt)}`
        const current = event.id === currentEventId
        const flash = flashes.get(event.id) ?? null

        return (
          <m.li
            key={event.id}
            layout={!reducedMotion}
            initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              ...rowEntrance(index, reducedMotion),
              layout: layoutTransition(reducedMotion),
            }}
            className="grid grid-cols-[44px_1fr] gap-x-3"
          >
            <span className="text-2xs text-muted-foreground pt-2.5 font-mono tabular-nums">
              {event.allDay ? 'day' : time}
            </span>
            <button
              type="button"
              data-event-id={event.id}
              aria-current={current ? 'true' : undefined}
              aria-label={`${event.title}, ${EVENT_TYPE_LABELS[event.eventType]}, ${time}`}
              onClick={() => onOpenEvent(event, 'panel')}
              onMouseEnter={() => onHighlight(event.id)}
              onMouseLeave={() => onHighlight(null)}
              className={cn(
                'group/row border-border-subtle hover:bg-accent relative w-full rounded-r-sm border-l py-2 pr-2 pl-3 text-left transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
                highlight === event.id && 'bg-accent',
                current && 'bg-surface-active hover:bg-surface-active',
                flash === 'new' && 'calendar-arrive',
                flash === 'updated' && 'calendar-changed',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-2.5 -left-px h-4 rounded-full transition-[width] duration-[120ms]',
                  current ? 'w-[3px]' : 'w-0.5',
                  markFor(event.eventType),
                )}
              />
              <span className="block truncate text-sm font-semibold">{event.title}</span>
              <span className="text-2xs text-muted-foreground block font-mono tabular-nums">
                {range}
              </span>
              {event.location ? (
                <span className="bg-elevated border-border text-secondary-foreground text-2xs mt-1.5 inline-flex h-5 max-w-full items-center gap-1 rounded-xs border px-1.5">
                  <MapPin className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{event.location}</span>
                </span>
              ) : null}
            </button>
          </m.li>
        )
      })}
    </ul>
  )
}
