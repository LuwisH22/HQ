import { useEffect, useRef, type Dispatch, type KeyboardEvent } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { ArrowsClockwise, CaretLeft, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { CalendarEvent } from '@/services/calendar.service'
import { cn } from '@/lib/utils'
import { dayTitle, type DayKey } from './calendar-time'
import { panelBodyVariants } from './calendar-motion'
import {
  panelEventId,
  type Origin,
  type WorkspaceAction,
  type WorkspaceState,
} from './calendar-workspace-state'
import type { EventFormValues } from './event-form'
import { EVENT_TYPE_LABELS, markFor } from './event-types'
import type { RowFlash } from './EventRow'
import { ConfirmStrip } from './ConfirmStrip'
import { DaySchedulePanel } from './DaySchedulePanel'
import { EventDetailPanel } from './EventDetailPanel'
import { EventFormBody } from './EventFormBody'

const FORM_ID = 'calendar-event-form'

export interface CalendarContextPanelProps {
  state: WorkspaceState
  dispatch: Dispatch<WorkspaceAction>
  today: DayKey
  displayZone: string
  /** The selected day's events, in the order the day is read. */
  dayEvents: readonly CalendarEvent[]
  /** The event the panel is about, if it is loaded. */
  openEvent: CalendarEvent | null
  loading: boolean
  highlight: string | null
  flashes: ReadonlyMap<string, RowFlash>
  canCreate: boolean
  /** Whether this reader may change the open event. */
  mayChange: boolean
  reducedMotion: boolean
  saving: boolean
  saveError: unknown
  deleting: boolean
  deleteError: unknown
  /** The event under the form changed since editing began. */
  staleEdit: boolean
  reloadToken: number
  onReloadForm: () => void
  onSubmit: (values: EventFormValues) => void
  onConfirmDelete: () => void
  onOpenEvent: (event: CalendarEvent, from: Origin) => void
  onHighlight: (eventId: string | null) => void
  /** Stable, so the form's dirty effect does not re-run on every render. */
  onDirtyChange: (dirty: boolean) => void
}

/**
 * The second primary workspace.
 *
 * Four bodies and one identity: the column beside the grid, on the same
 * canvas, separated by a hairline. It describes the selected day until an
 * event is opened, and then it is that event — deeper into the same place,
 * not a new screen. Creating and editing happen here too, with the calendar
 * still visible beside them, and the two confirmations are strips beneath
 * the footer rather than dialogs over it.
 *
 * The header and footer hold still; only the body crosses over, sliding six
 * pixels in the direction the reducer says it moved. Nothing here decides
 * where to go — every button dispatches, and the reducer decides, so the
 * dirty guard is the same one wherever a person tries to leave from.
 */
export function CalendarContextPanel(props: CalendarContextPanelProps) {
  const { state, dispatch, openEvent, mayChange, reducedMotion } = props
  const { panel } = state
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Opening an event moves the keyboard to its heading, so the next Tab lands
  // on an action; forms take their own first field. Not on mount — a page
  // arriving at an event from a link should not grab focus from the shell.
  const eventId = panelEventId(panel)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (panel.mode !== 'event') return
    const id = window.setTimeout(() => headingRef.current?.focus(), 130)
    return () => window.clearTimeout(id)
  }, [panel.mode, eventId])

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const editable = /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName)
    if (event.key === 'Escape') {
      event.preventDefault()
      if (state.confirmingDelete) dispatch({ type: 'CONFIRM_DELETE', open: false })
      else if (state.pending) dispatch({ type: 'GUARD_KEEP' })
      else if (panel.mode === 'edit' || panel.mode === 'create') dispatch({ type: 'CANCEL_FORM' })
      else dispatch({ type: 'BACK' })
      return
    }
    if (editable) return
    if (panel.mode === 'event' && mayChange) {
      if (event.key === 'e' || event.key === 'E') {
        event.preventDefault()
        dispatch({ type: 'START_EDIT' })
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        dispatch({ type: 'CONFIRM_DELETE', open: true })
      }
    }
  }

  // The body is keyed so a change of mode, or of event, is a change of body.
  // A change of day is not: the rundown re-keys its own rows and staggers.
  const bodyKey = panel.mode === 'day' ? 'day' : `${panel.mode}:${eventId ?? 'new'}`
  const inForm = panel.mode === 'edit' || panel.mode === 'create'

  return (
    <section
      aria-labelledby="calendar-panel-title"
      onKeyDown={onKeyDown}
      className="bg-background flex h-full min-h-0 flex-col"
    >
      <Header {...props} headingRef={headingRef} />

      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false} custom={state.transition}>
          <m.div
            key={bodyKey}
            custom={state.transition}
            variants={panelBodyVariants(reducedMotion)}
            initial="enter"
            animate="center"
            exit="exit"
            className="absolute inset-0 overflow-y-auto px-5 pt-3 pb-5"
          >
            <Body {...props} />
          </m.div>
        </AnimatePresence>
      </div>

      {/* --- Footer: the actions for what the body is ---------------------- */}
      {panel.mode === 'event' && openEvent && mayChange ? (
        <footer className="border-border-subtle bg-surface shrink-0 border-t">
          <div className="flex items-center gap-2 px-5 py-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => dispatch({ type: 'START_EDIT' })}
            >
              <PencilSimple aria-hidden="true" />
              Edit event
              <kbd className="text-3xs text-muted-foreground bg-background border-border-subtle hidden rounded-xs border px-1 md:inline">
                E
              </kbd>
            </Button>
            <div className="flex-1" />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={state.confirmingDelete}
              onClick={() => dispatch({ type: 'CONFIRM_DELETE', open: true })}
            >
              <Trash aria-hidden="true" />
              Delete event
            </Button>
          </div>
          <ConfirmStrip
            open={state.confirmingDelete}
            tone="danger"
            title="Delete this event?"
            description={`“${openEvent.title}” will be removed for everyone. This cannot be undone.`}
            cancelLabel="Cancel"
            confirmLabel="Delete event"
            confirming={props.deleting}
            error={props.deleteError}
            onCancel={() => dispatch({ type: 'CONFIRM_DELETE', open: false })}
            onConfirm={props.onConfirmDelete}
          />
        </footer>
      ) : null}

      {inForm ? (
        <footer className="border-border-subtle bg-surface shrink-0 border-t">
          {props.staleEdit ? (
            <div className="border-border-subtle bg-warning/6 flex items-center gap-2 border-b px-5 py-2 text-xs">
              <span className="bg-warning size-1.5 shrink-0 rounded-full" aria-hidden="true" />
              <span className="text-secondary-foreground min-w-0 flex-1">
                This event was changed while you were editing.
              </span>
              <Button type="button" variant="link" size="sm" onClick={props.onReloadForm}>
                <ArrowsClockwise aria-hidden="true" />
                Reload form
              </Button>
            </div>
          ) : null}
          <div className="flex items-center gap-2 px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.saving}
              onClick={() => dispatch({ type: 'CANCEL_FORM' })}
            >
              Cancel
            </Button>
            <div className="flex-1" />
            <Button
              type="submit"
              form={FORM_ID}
              size="sm"
              loading={props.saving}
              disabled={!state.dirty}
            >
              {panel.mode === 'create' ? 'Create event' : 'Save changes'}
            </Button>
          </div>
          <ConfirmStrip
            open={state.pending !== null}
            tone="warning"
            title="Discard changes?"
            description="What you have typed here will be lost."
            cancelLabel="Keep editing"
            confirmLabel="Discard"
            onCancel={() => dispatch({ type: 'GUARD_KEEP' })}
            onConfirm={() => dispatch({ type: 'GUARD_DISCARD' })}
          />
        </footer>
      ) : null}
    </section>
  )
}

function Header({
  state,
  dispatch,
  today,
  displayZone,
  dayEvents,
  openEvent,
  canCreate,
  headingRef,
}: CalendarContextPanelProps & { headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const { panel, selected } = state
  const isToday = selected === today
  const count =
    dayEvents.length === 0
      ? 'No events'
      : `${String(dayEvents.length)} event${dayEvents.length === 1 ? '' : 's'}`

  const crumb = (
    <button
      type="button"
      onClick={() => dispatch({ type: 'BACK' })}
      className="text-muted-foreground hover:bg-accent hover:text-foreground -ml-1 inline-flex h-5 w-max items-center gap-1 rounded-xs pr-1.5 pl-0.5 text-xs transition-colors duration-[120ms]"
    >
      <CaretLeft className="size-3" aria-hidden="true" />
      {panel.mode === 'edit'
        ? 'Back to event'
        : `Back to schedule · ${shortDay(selected, displayZone)}`}
    </button>
  )

  return (
    <div className="border-border-subtle bg-surface min-h-[88px] shrink-0 space-y-1 border-b px-5 pt-3.5 pb-3">
      {panel.mode === 'day' ? (
        <p className="display-eyebrow text-3xs text-muted-foreground">Scheduled</p>
      ) : (
        crumb
      )}

      <h2
        id="calendar-panel-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-[18px] leading-6 font-semibold tracking-[-0.01em] text-balance outline-none focus-visible:underline focus-visible:decoration-[var(--accent-text)] focus-visible:underline-offset-4"
      >
        {panel.mode === 'day'
          ? dayTitle(selected, displayZone)
          : panel.mode === 'create'
            ? 'New event'
            : panel.mode === 'edit'
              ? 'Edit event'
              : (openEvent?.title ?? 'Event')}
      </h2>

      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        {panel.mode === 'day' ? (
          <>
            <span>{count}</span>
            {isToday ? <span>· Today</span> : null}
            <span className="flex-1" />
            {canCreate ? (
              <Button
                type="button"
                size="sm"
                onClick={() => dispatch({ type: 'START_CREATE' })}
                className="-my-1"
              >
                <Plus aria-hidden="true" />
                New event
              </Button>
            ) : null}
          </>
        ) : panel.mode === 'event' && openEvent ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn('h-3 w-0.5 rounded-full', markFor(openEvent.eventType))}
            />
            <span className="display-eyebrow text-3xs text-secondary-foreground">
              {EVENT_TYPE_LABELS[openEvent.eventType]}
            </span>
          </span>
        ) : (
          <span>{dayTitle(selected, displayZone)}</span>
        )}
      </div>
    </div>
  )
}

function Body(props: CalendarContextPanelProps) {
  const { state, openEvent, loading } = props
  const { panel } = state

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-3 w-2/5 rounded-xs" />
        <Skeleton className="h-3 w-4/5 rounded-xs" />
        <Skeleton className="h-3 w-3/5 rounded-xs" />
      </div>
    )
  }

  switch (panel.mode) {
    case 'day':
      return (
        <DaySchedulePanel
          day={state.selected}
          events={props.dayEvents}
          displayZone={props.displayZone}
          currentEventId={null}
          highlight={props.highlight}
          flashes={props.flashes}
          reducedMotion={props.reducedMotion}
          onOpenEvent={props.onOpenEvent}
          onHighlight={props.onHighlight}
        />
      )
    case 'event':
      return openEvent ? (
        <EventDetailPanel
          event={openEvent}
          displayZone={props.displayZone}
          changed={props.flashes.get(openEvent.id) === 'updated'}
        />
      ) : (
        <p className="text-muted-foreground text-sm">This event is no longer on the calendar.</p>
      )
    case 'edit':
      return openEvent ? (
        <EventFormBody
          formId={FORM_ID}
          mode="edit"
          event={openEvent}
          timezone={props.displayZone}
          error={props.saveError}
          reloadToken={props.reloadToken}
          onSubmit={props.onSubmit}
          onDirtyChange={props.onDirtyChange}
        />
      ) : null
    case 'create':
      return (
        <EventFormBody
          formId={FORM_ID}
          mode="create"
          seed={panel.seed}
          timezone={props.displayZone}
          error={props.saveError}
          onSubmit={props.onSubmit}
          onDirtyChange={props.onDirtyChange}
        />
      )
  }
}

/** "Mon 8 Sep", for the breadcrumb. */
function shortDay(day: DayKey, displayZone: string): string {
  return dayTitle(day, displayZone).replace(/^(\w{3})\w*, (\d+) (\w{3})\w* \d{4}$/, '$1 $2 $3')
}
