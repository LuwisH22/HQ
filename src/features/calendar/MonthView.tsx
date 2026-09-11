import { memo, useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { Plus } from '@phosphor-icons/react'
import type { CalendarEvent } from '@/services/calendar.service'
import { cn } from '@/lib/utils'
import {
  addDays,
  dayNumber,
  dayTitle,
  monthGridDays,
  monthOf,
  monthTitle,
  weekdayIndex,
  type DayKey,
} from './calendar-time'
import { gridVariants } from './calendar-motion'
import type { GridDirection, Origin } from './calendar-workspace-state'
import { EventRow, type RowFlash } from './EventRow'

/** Monday first, as the grid is drawn and as the week helpers count. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Any more in a cell and the row heights start deciding the layout. */
const PER_CELL = 3

export interface MonthViewProps {
  anchor: DayKey
  today: DayKey
  selected: DayKey
  focused: DayKey
  /** The event the panel is showing, if it is one. */
  currentEventId: string | null
  /** The event being hovered in the panel, mirrored here. */
  highlight: string | null
  flashes: ReadonlyMap<string, RowFlash>
  byDay: ReadonlyMap<DayKey, CalendarEvent[]>
  displayZone: string
  canCreate: boolean
  direction: GridDirection
  reducedMotion: boolean
  onSelectDay: (day: DayKey) => void
  onFocusDay: (day: DayKey) => void
  onOpenEvent: (event: CalendarEvent, from: Origin) => void
  onCreateOn: (day: DayKey) => void
  onHighlight: (eventId: string | null) => void
  onNavigate: (direction: -1 | 1, months: number) => void
  onToday: () => void
  /** Enter on the already-selected day: hand the keyboard to the panel. */
  onEnterPanel: () => void
}

/**
 * The month, as six weeks.
 *
 * Always six rows, so a month with a leading Sunday does not make the grid
 * taller than the one before it. Days from the neighbouring months are drawn
 * quieter rather than hidden: the week they are in is on screen either way.
 *
 * This is the primary workspace and the panel beside it describes whichever
 * day is selected, so a cell is a selection rather than a link: clicking one
 * repaints the panel and nothing navigates. Exactly one cell is selected at
 * all times, and it wears an inset accent edge; today is a marked number and
 * an `aria-current`, never a filled circle.
 *
 * One tab stop for the whole grid, roving with the arrow keys the way an
 * `aria` grid is expected to. The rows inside a cell are reachable with Tab
 * from that cell, so a keyboard reaches "Scrim vs Onyx" without opening the
 * day first. The keys are the audit's, §F.
 */
export function MonthView(props: MonthViewProps) {
  const {
    anchor,
    focused,
    selected,
    direction,
    reducedMotion,
    onFocusDay,
    onSelectDay,
    onNavigate,
    onToday,
    onEnterPanel,
    onCreateOn,
    canCreate,
  } = props
  const month = monthOf(anchor)
  const days = monthGridDays(anchor)

  // Set when the keyboard asked for a move, so the cell that arrives — in this
  // month or, after a page turn, in the next — takes the focus with it.
  const wantsFocus = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)

  const focusPending = useCallback(() => {
    if (!wantsFocus.current) return
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-day="${focused}"]`)
    if (cell) {
      wantsFocus.current = false
      cell.focus()
    }
  }, [focused])

  // Same month: the cell already exists. Next month: it arrives with the
  // incoming grid, whose `onAnimationComplete` asks again.
  useEffect(focusPending)

  function moveFocus(day: DayKey): void {
    wantsFocus.current = true
    onFocusDay(day)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement
    const cell = target.closest<HTMLElement>('[data-day]')
    if (!cell) return
    const day = cell.dataset.day as DayKey
    const onCell = target === cell

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        event.preventDefault()
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
        moveFocus(addDays(day, step))
        return
      }
      case 'Home':
        event.preventDefault()
        moveFocus(addDays(day, -weekdayIndex(day)))
        return
      case 'End':
        event.preventDefault()
        moveFocus(addDays(day, 6 - weekdayIndex(day)))
        return
      case 'PageUp':
      case 'PageDown': {
        event.preventDefault()
        wantsFocus.current = true
        onNavigate(event.key === 'PageUp' ? -1 : 1, event.shiftKey ? 12 : 1)
        return
      }
      case 't':
      case 'T':
        if (!onCell) return
        event.preventDefault()
        wantsFocus.current = true
        onToday()
        return
      case 'n':
      case 'N':
        if (!onCell || !canCreate) return
        event.preventDefault()
        onCreateOn(day)
        return
      case 'Enter':
      case ' ': {
        if (!onCell) return
        event.preventDefault()
        if (day === selected) onEnterPanel()
        else onSelectDay(day)
        return
      }
      case 'Tab': {
        // Tab walks into the cell's rows and out the far side; Shift+Tab
        // walks back to the cell. Other cells are not stops, so leaving the
        // last row leaves the grid, as it should.
        const rows = Array.from(cell.querySelectorAll<HTMLElement>('[data-event-id],[data-more]'))
        if (rows.length === 0) return
        if (onCell) {
          if (event.shiftKey) return
          event.preventDefault()
          rows[0]?.focus()
          return
        }
        const index = rows.indexOf(target)
        if (index === -1) return
        if (event.shiftKey) {
          event.preventDefault()
          ;(index > 0 ? rows[index - 1] : cell)?.focus()
        } else if (index < rows.length - 1) {
          event.preventDefault()
          rows[index + 1]?.focus()
        }
        return
      }
    }
  }

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={monthTitle(anchor, props.displayZone)}
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={onKeyDown}
    >
      <div
        className="border-border-subtle grid shrink-0 grid-cols-[repeat(7,minmax(0,1fr))] border-b"
        role="row"
      >
        {WEEKDAYS.map((label) => (
          <div
            key={label}
            role="columnheader"
            className="display-eyebrow text-3xs text-muted-foreground h-8 px-2.5 leading-8"
          >
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.slice(0, 1)}</span>
          </div>
        ))}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <m.div
            key={month}
            role="rowgroup"
            custom={direction}
            variants={gridVariants(reducedMotion)}
            initial="enter"
            animate="center"
            exit="exit"
            onAnimationComplete={(definition) => {
              if (definition === 'center') focusPending()
            }}
            className="flex h-full flex-col overflow-x-hidden overflow-y-auto"
          >
            {Array.from({ length: 6 }, (_, row) => (
              <div
                key={row}
                role="row"
                className="border-border-subtle grid min-h-[84px] flex-1 grid-cols-[repeat(7,minmax(0,1fr))] border-b last:border-b-0"
              >
                {days.slice(row * 7, row * 7 + 7).map((day, column) => {
                  const dayEvents = props.byDay.get(day) ?? []
                  return (
                    <DayCell
                      key={day}
                      day={day}
                      events={dayEvents}
                      outside={monthOf(day) !== month}
                      isToday={day === props.today}
                      isSelected={day === selected}
                      isFocused={day === focused}
                      firstColumn={column === 0}
                      currentEventId={
                        props.currentEventId && dayEvents.some((e) => e.id === props.currentEventId)
                          ? props.currentEventId
                          : null
                      }
                      highlight={
                        props.highlight && dayEvents.some((e) => e.id === props.highlight)
                          ? props.highlight
                          : null
                      }
                      flashes={props.flashes}
                      displayZone={props.displayZone}
                      canCreate={canCreate}
                      onSelectDay={onSelectDay}
                      onOpenEvent={props.onOpenEvent}
                      onCreateOn={onCreateOn}
                      onHighlight={props.onHighlight}
                      onEnterPanel={onEnterPanel}
                    />
                  )
                })}
              </div>
            ))}
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

interface DayCellProps {
  day: DayKey
  events: CalendarEvent[]
  outside: boolean
  isToday: boolean
  isSelected: boolean
  isFocused: boolean
  firstColumn: boolean
  currentEventId: string | null
  highlight: string | null
  flashes: ReadonlyMap<string, RowFlash>
  displayZone: string
  canCreate: boolean
  onSelectDay: (day: DayKey) => void
  onOpenEvent: (event: CalendarEvent, from: Origin) => void
  onCreateOn: (day: DayKey) => void
  onHighlight: (eventId: string | null) => void
  onEnterPanel: () => void
}

/**
 * One day.
 *
 * Memoised on what it draws, so hovering a row in the panel re-renders the
 * one cell that contains that row rather than forty-two of them.
 */
const DayCell = memo(function DayCell({
  day,
  events,
  outside,
  isToday,
  isSelected,
  isFocused,
  firstColumn,
  currentEventId,
  highlight,
  flashes,
  displayZone,
  canCreate,
  onSelectDay,
  onOpenEvent,
  onCreateOn,
  onHighlight,
  onEnterPanel,
}: DayCellProps) {
  const hidden = Math.max(0, events.length - PER_CELL)
  const count =
    events.length === 0
      ? 'no events'
      : `${String(events.length)} event${events.length === 1 ? '' : 's'}`

  function onClick(event: MouseEvent<HTMLDivElement>): void {
    // Rows and the two small buttons handle themselves.
    if ((event.target as HTMLElement).closest('button')) return
    onSelectDay(day)
  }

  return (
    <div
      role="gridcell"
      data-day={day}
      tabIndex={isFocused ? 0 : -1}
      aria-selected={isSelected}
      aria-current={isToday ? 'date' : undefined}
      aria-label={`${dayTitle(day, displayZone)}${isToday ? ', today' : ''}, ${count}`}
      onClick={onClick}
      className={cn(
        'group/cell border-border-subtle relative flex min-h-0 min-w-0 cursor-pointer flex-col gap-px p-1 transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
        !firstColumn && 'border-l',
        'hover:bg-accent',
        isSelected &&
          'bg-surface-active hover:bg-surface-active shadow-[inset_0_0_0_1px_var(--accent-text)]',
        outside && !isSelected && 'bg-background/40',
      )}
    >
      <div className="flex h-5 items-center justify-between px-1">
        <span
          className={cn(
            'text-2xs font-mono tabular-nums',
            isToday
              ? 'text-accent-text font-medium'
              : isSelected
                ? 'text-foreground'
                : outside
                  ? 'text-muted-foreground/60'
                  : 'text-muted-foreground',
          )}
        >
          {dayNumber(day)}
        </span>
        {/* A quiet way to add something to a day without leaving the grid.
            Desktop only; on a phone the panel's own button is the way. */}
        {canCreate ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`New event on ${dayTitle(day, displayZone)}`}
            onClick={() => onCreateOn(day)}
            className="text-muted-foreground hover:bg-elevated hover:text-foreground hidden size-4 items-center justify-center rounded-xs opacity-0 transition-opacity delay-200 duration-[120ms] group-focus-within/cell:opacity-100 group-hover/cell:opacity-100 md:flex"
          >
            <Plus className="size-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {events.slice(0, PER_CELL).map((event) => (
        <EventRow
          key={event.id}
          event={event}
          displayZone={displayZone}
          onOpen={(opened) => onOpenEvent(opened, 'grid')}
          compact
          tabIndex={-1}
          current={event.id === currentEventId}
          highlighted={event.id === highlight}
          flash={flashes.get(event.id) ?? null}
          onHoverChange={onHighlight}
        />
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          data-more
          tabIndex={-1}
          onClick={() => {
            onSelectDay(day)
            onEnterPanel()
          }}
          className="text-3xs text-muted-foreground hover:text-foreground h-4 w-full rounded-xs px-1 text-left font-mono transition-colors"
        >
          +{hidden} more
        </button>
      ) : null}
    </div>
  )
})
