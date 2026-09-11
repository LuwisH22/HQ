import type { CalendarEvent } from '@/services/calendar.service'
import { cn } from '@/lib/utils'
import { EVENT_TYPE_LABELS, markFor } from './event-types'
import { clockIn } from './calendar-time'

/** Why a row is briefly tinted: it just arrived, or somebody else changed it. */
export type RowFlash = 'new' | 'updated'

/**
 * One event, as a row.
 *
 * The same shape wherever it appears — a mark for the category, the title, the
 * time in mono — so a month cell and a day rundown read as the same product.
 * The category is a 2px mark and a word in the accessible name, never a
 * coloured block: seven filled rectangles is somebody else's calendar.
 *
 * Three states beyond rest, all of them a tone rather than a colour: hovered
 * (here or in the panel — the two highlight each other), open in the panel
 * (`aria-current`, and the mark grows a pixel), and a short-lived flash for a
 * row that just arrived or was changed by somebody else.
 */
export function EventRow({
  event,
  displayZone,
  onOpen,
  compact = false,
  current = false,
  highlighted = false,
  flash = null,
  tabIndex,
  onHoverChange,
}: {
  event: CalendarEvent
  displayZone: string
  onOpen: (event: CalendarEvent) => void
  /** Month cells have no room for a second line. */
  compact?: boolean
  /** This is the event the panel is showing. */
  current?: boolean
  /** Its twin in the other half of the workspace is being hovered. */
  highlighted?: boolean
  flash?: RowFlash | null
  tabIndex?: number
  onHoverChange?: (eventId: string | null) => void
}) {
  const time = event.allDay ? 'All day' : clockIn(event.startsAt, displayZone)

  return (
    <button
      type="button"
      data-event-id={event.id}
      tabIndex={tabIndex}
      onClick={() => onOpen(event)}
      onMouseEnter={onHoverChange ? () => onHoverChange(event.id) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(null) : undefined}
      aria-current={current ? 'true' : undefined}
      // The category and the time are in the name rather than only in the
      // mark and the mono column, so nothing here depends on seeing colour.
      aria-label={`${event.title}, ${EVENT_TYPE_LABELS[event.eventType]}, ${time}`}
      className={cn(
        'group/event hover:bg-accent flex w-full items-center gap-1.5 rounded-xs text-left transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
        compact ? 'h-5 px-1' : 'min-h-6 px-1.5 py-1',
        highlighted && 'bg-accent',
        current && 'bg-surface-active',
        flash === 'new' && 'calendar-arrive',
        flash === 'updated' && 'calendar-changed',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-3 shrink-0 rounded-full transition-[width] duration-[120ms]',
          current ? 'w-[3px]' : 'w-0.5',
          markFor(event.eventType),
        )}
      />
      {/* A month cell on a phone is fifty pixels wide: the title is the
          information, and the clock is one tap away in the event itself. */}
      {compact ? (
        <span className="text-3xs text-muted-foreground hidden shrink-0 font-mono tabular-nums lg:inline">
          {event.allDay ? '—' : time}
        </span>
      ) : null}
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          compact ? 'text-2xs' : 'text-xs',
          current || highlighted
            ? 'text-foreground'
            : 'text-secondary-foreground group-hover/event:text-foreground',
        )}
      >
        {event.title}
      </span>
      {compact ? null : (
        <span className="text-2xs text-muted-foreground shrink-0 font-mono tabular-nums">
          {event.allDay ? '—' : time}
        </span>
      )}
    </button>
  )
}
