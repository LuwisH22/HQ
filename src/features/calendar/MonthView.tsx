import { useMemo } from 'react'
import type { CalendarEvent } from '@/services/calendar.service'
import { cn } from '@/lib/utils'
import { groupByDay } from './calendar-layout'
import { dayNumber, monthGridDays, monthOf, type DayKey } from './calendar-time'
import { EventRow } from './EventRow'

/** Monday first, as the grid is drawn and as the week helpers count. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Any more in a cell and the row heights start deciding the layout. */
const PER_CELL = 3

/**
 * The month, as six weeks.
 *
 * Always six rows, so a month with a leading Sunday does not make the page
 * taller than the one before it. Days from the neighbouring months are drawn
 * quieter rather than hidden: the week they are in is on screen either way.
 *
 * Today is a tinted cell and a marked number — never a filled circle, which is
 * the one thing every calendar does and the one thing Blackout has no shape
 * for.
 */
export function MonthView({
  anchor,
  today,
  events,
  displayZone,
  onOpenEvent,
  onOpenDay,
}: {
  anchor: DayKey
  today: DayKey
  events: readonly CalendarEvent[]
  displayZone: string
  onOpenEvent: (event: CalendarEvent) => void
  onOpenDay: (day: DayKey) => void
}) {
  const days = useMemo(() => monthGridDays(anchor), [anchor])
  const byDay = useMemo(() => groupByDay(events, displayZone), [events, displayZone])
  const month = monthOf(anchor)

  return (
    <div className="border-border bg-card overflow-hidden rounded-md border">
      <div className="border-border-subtle grid grid-cols-7 border-b" role="presentation">
        {WEEKDAYS.map((label) => (
          <div key={label} className="display-eyebrow text-3xs text-muted-foreground px-2 py-2">
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.slice(0, 1)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const dayEvents = byDay.get(day) ?? []
          const outside = monthOf(day) !== month
          const isToday = day === today
          const hidden = Math.max(0, dayEvents.length - PER_CELL)

          return (
            <div
              key={day}
              className={cn(
                'border-border-subtle min-h-[92px] border-b p-1 sm:min-h-[112px]',
                index % 7 !== 0 && 'border-l',
                index >= 35 && 'border-b-0',
                outside && 'bg-background/40',
                isToday && 'bg-surface-active/40',
              )}
            >
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                // Today is an underline and a state, not only a tint: the word
                // beside it has nowhere to go on a phone.
                aria-current={isToday ? 'date' : undefined}
                aria-label={`Open ${day}${isToday ? ', today' : ''}`}
                className={cn(
                  'mb-0.5 flex h-6 w-full items-center gap-1.5 rounded-sm px-1 transition-colors duration-[120ms]',
                  'hover:bg-surface',
                )}
              >
                <span
                  className={cn(
                    'text-2xs font-mono tabular-nums',
                    isToday
                      ? 'text-accent-text decoration-accent-text font-semibold underline underline-offset-4'
                      : outside
                        ? 'text-muted-foreground/60'
                        : 'text-secondary-foreground',
                  )}
                >
                  {dayNumber(day)}
                </span>
                {/* Today says so in a word as well as in a tone. */}
                {isToday ? (
                  <span className="display-eyebrow text-3xs text-accent-text hidden sm:inline">
                    Today
                  </span>
                ) : null}
              </button>

              <div className="space-y-px">
                {dayEvents.slice(0, PER_CELL).map((event) => (
                  <EventRow
                    key={`${day}:${event.id}`}
                    event={event}
                    displayZone={displayZone}
                    onOpen={onOpenEvent}
                    compact
                  />
                ))}
                {hidden > 0 ? (
                  <button
                    type="button"
                    onClick={() => onOpenDay(day)}
                    className="text-2xs text-muted-foreground hover:text-foreground w-full px-1 text-left font-mono transition-colors"
                  >
                    +{hidden} more
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
