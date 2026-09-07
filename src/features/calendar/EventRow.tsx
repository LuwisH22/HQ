import type { CalendarEvent } from '@/services/calendar.service'
import { cn } from '@/lib/utils'
import { EVENT_TYPE_LABELS, markFor } from './event-types'
import { clockIn } from './calendar-time'

/**
 * One event, as a row.
 *
 * The same shape wherever it appears — a mark for the category, the title, the
 * time in mono — so a month cell and a day timeline read as the same product.
 * The category is a 2px mark and a word in the accessible name, never a
 * coloured block: seven filled rectangles is somebody else's calendar.
 */
export function EventRow({
  event,
  displayZone,
  onOpen,
  compact = false,
}: {
  event: CalendarEvent
  displayZone: string
  onOpen: (event: CalendarEvent) => void
  /** Month cells have no room for a second line. */
  compact?: boolean
}) {
  const time = event.allDay ? 'All day' : clockIn(event.startsAt, displayZone)

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      // The category and the time are in the name rather than only in the
      // mark and the mono column, so nothing here depends on seeing colour.
      aria-label={`${event.title}, ${EVENT_TYPE_LABELS[event.eventType]}, ${time}`}
      className={cn(
        'group/event hover:bg-surface flex w-full items-center gap-1.5 rounded-sm text-left transition-colors duration-[120ms]',
        compact ? 'h-[18px] px-1' : 'min-h-6 px-1.5 py-1',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-3 w-0.5 shrink-0 rounded-full', markFor(event.eventType))}
      />
      <span
        className={cn(
          'text-secondary-foreground group-hover/event:text-foreground min-w-0 flex-1 truncate',
          compact ? 'text-2xs' : 'text-xs',
        )}
      >
        {event.title}
      </span>
      {/* A month cell on a phone is fifty pixels wide: the title is the
          information, and the clock is one tap away in the event itself. */}
      <span
        className={cn(
          'text-2xs text-muted-foreground shrink-0 font-mono tabular-nums',
          compact && 'hidden sm:inline',
        )}
      >
        {event.allDay ? '—' : clockIn(event.startsAt, displayZone)}
      </span>
    </button>
  )
}
