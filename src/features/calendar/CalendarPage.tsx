import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LazyMotion, domAnimation, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { ErrorState, ForbiddenState } from '@/components/common/states'
import { Skeleton } from '@/components/ui/skeleton'
import { profileService } from '@/services/profile.service'
import type { CalendarEvent } from '@/services/calendar.service'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { useIsDesktop } from '@/hooks/use-media-query'
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut'
import { detectTimezone } from '@/utils/datetime'
import { cn } from '@/lib/utils'
import {
  dayKeyOf,
  dayTitle,
  monthGridDays,
  monthOf,
  monthTitle,
  rangeForDays,
  todayKey,
  weekDays,
  weekTitle,
  type DayKey,
} from './calendar-time'
import { groupByDay } from './calendar-layout'
import { toEventInput, type EventFormValues } from './event-form'
import { panelEventId, type Origin, type View } from './calendar-workspace-state'
import { useCalendarWorkspace } from './use-calendar-workspace'
import { useCalendarEvents } from './use-calendar-events'
import { useCalendarRealtime } from './use-calendar-realtime'
import { useCalendarMutations } from './use-calendar-mutations'
import { useCanEditEvent } from './use-can-edit-event'
import type { RowFlash } from './EventRow'
import { CalendarToolbar } from './CalendarToolbar'
import { MonthView } from './MonthView'
import { TimeGrid } from './TimeGrid'
import { CalendarContextPanel } from './CalendarContextPanel'
import { MobileContextSheet } from './MobileContextSheet'

/**
 * The organization's calendar, as a workspace.
 *
 * Two halves. The grid is where things are; the panel beside it is what they
 * are. Selecting a day repaints the panel with that day's rundown, opening an
 * event turns the panel into that event, and writing or changing one happens
 * in the same column with the month still visible beside it. Nothing opens
 * over the calendar; there are no dialogs here any more.
 *
 * WHICH CLOCK. Events are stored as instants, so a calendar has to choose a
 * zone to read them in, and this reads them in the viewer's — their profile
 * timezone, then the organization's, then the browser's. All-day events are
 * the exception and are placed by the zone they were written in, because
 * "the bootcamp is on the 5th" is the 5th wherever it is read.
 *
 * Which day, which view and which event are the reducer's, and four of its
 * values are the URL's. The events themselves live in TanStack Query, and
 * realtime keeps them current by invalidation: what arrives here is compared
 * with what was there, so a row somebody else changed is briefly tinted and
 * a form somebody else changed under is told, without a second copy of the
 * placement rules anywhere.
 */

const DESKTOP_VIEWS: readonly { id: View; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
]
const MOBILE_VIEWS: readonly { id: View; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'day', label: 'Day' },
]

/** How long a row that arrived or changed stays tinted. */
const FLASH_MS = 1200

export function CalendarPage() {
  const { organization } = useWorkspace()
  const canView = usePermission('calendar.view')
  const canCreate = usePermission('calendar.create')
  const isDesktop = useIsDesktop()
  const reducedMotion = useReducedMotion() ?? false

  // The viewer's own zone, which is what the profile field is for. Falls back
  // to the organization's baseline and then to the browser's.
  const profileQuery = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: () => profileService.getMine(),
    staleTime: 5 * 60_000,
  })
  const displayZone = profileQuery.data?.timezone ?? organization?.timezone ?? detectTimezone()

  // Somebody else's scrim appears, moves or disappears while this page is
  // open, without anybody pressing anything. Only for a reader who may see the
  // calendar at all.
  useCalendarRealtime(canView ? organization?.id : undefined)

  const today = todayKey(displayZone)
  const [state, dispatch] = useCalendarWorkspace(today, isDesktop)
  const { view, anchor, selected, panel } = state

  // The days on screen, which are also the query's window.
  const days = useMemo(() => {
    if (view === 'month') return monthGridDays(anchor)
    if (view === 'week') return weekDays(anchor)
    return [selected]
  }, [view, anchor, selected])
  const range = useMemo(() => rangeForDays(days, displayZone), [days, displayZone])
  const query = useCalendarEvents(canView ? organization?.id : undefined, range)
  const events = useMemo(() => query.data ?? [], [query.data])
  const byDay = useMemo(() => groupByDay(events, displayZone), [events, displayZone])
  const dayEvents = useMemo(() => byDay.get(selected) ?? [], [byDay, selected])

  // The event the panel is about. Remembered once seen, so turning the month
  // over keeps an open event open even when it has left the window.
  const openEventId = panelEventId(panel)
  const lastOpen = useRef<CalendarEvent | null>(null)
  const found = openEventId ? (events.find((event) => event.id === openEventId) ?? null) : null
  if (found) lastOpen.current = found
  const openEvent = found ?? (lastOpen.current?.id === openEventId ? lastOpen.current : null)
  const mayChange = useCanEditEvent(openEvent)

  const mutations = useCalendarMutations(organization?.id)

  /* --- Cross-highlight: hover in one half, tint in the other -------------- */
  const [highlight, setHighlight] = useState<string | null>(null)
  const onHighlight = useCallback((eventId: string | null) => setHighlight(eventId), [])

  /* --- What just changed ------------------------------------------------- */
  // Each window's rows and their `updatedAt`, so the next refetch can say
  // which rows are new and which were changed. Own writes are marked quiet
  // once so a save does not flash the row the person is looking at.
  const [flashes, setFlashes] = useState<ReadonlyMap<string, RowFlash>>(new Map())
  const seen = useRef<{ window: string; rows: Map<string, string> } | null>(null)
  const quiet = useRef(new Set<string>())
  const windowKey = `${range.from.toISOString()}|${range.to.toISOString()}`

  useEffect(() => {
    if (!query.data) return
    const rows = new Map(query.data.map((event) => [event.id, event.updatedAt]))
    const previous = seen.current
    seen.current = { window: windowKey, rows }
    // A first load, or a different window: nothing "arrived".
    if (!previous || previous.window !== windowKey) return

    const changed = new Map<string, RowFlash>()
    for (const [id, updatedAt] of rows) {
      if (quiet.current.delete(id)) continue
      const before = previous.rows.get(id)
      if (before === undefined) changed.set(id, 'new')
      else if (before !== updatedAt) changed.set(id, 'updated')
    }
    if (changed.size === 0) return

    setFlashes((current) => new Map([...current, ...changed]))
    window.setTimeout(() => {
      setFlashes((current) => {
        const next = new Map(current)
        for (const id of changed.keys()) next.delete(id)
        return next
      })
    }, FLASH_MS)
  }, [query.data, windowKey])

  /* --- An edit under a form ---------------------------------------------- */
  const editingSince = useRef<string | null>(null)
  useEffect(() => {
    editingSince.current = panel.mode === 'edit' ? (openEvent?.updatedAt ?? null) : null
    // Only entering or leaving edit, or a different event, restarts the watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.mode, openEventId])
  const [reloadToken, setReloadToken] = useState(0)
  const staleEdit =
    panel.mode === 'edit' &&
    openEvent !== null &&
    editingSince.current !== null &&
    openEvent.updatedAt !== editingSince.current
  const onReloadForm = useCallback(() => {
    editingSince.current = lastOpen.current?.updatedAt ?? null
    setReloadToken((token) => token + 1)
  }, [])

  /* --- An event that is gone --------------------------------------------- */
  // Missing from a window that should contain it: somebody else removed it.
  // Own deletions are expected and say nothing.
  const expectRemoval = useRef<string | null>(null)
  useEffect(() => {
    if (!openEventId || query.isPending || !query.data || found) return
    if (expectRemoval.current === openEventId) return
    const remembered = lastOpen.current
    const zone = remembered ? (remembered.allDay ? remembered.timezone : displayZone) : displayZone
    const inWindow = remembered ? days.includes(dayKeyOf(remembered.startsAt, zone)) : true
    if (!inWindow) return
    dispatch({ type: 'EVENT_GONE', eventId: openEventId })
    if (remembered) toast(`“${remembered.title}” is no longer on the calendar.`)
  }, [openEventId, query.isPending, query.data, found, days, displayZone, dispatch])

  /* --- Focus, going back ------------------------------------------------- */
  // Back returns the keyboard to what opened the level: the row in the grid or
  // in the rundown, or failing either, the selected day's cell.
  const rootRef = useRef<HTMLDivElement>(null)
  const lastOrigin = useRef(state.origin)
  if (state.origin) lastOrigin.current = state.origin
  const previousMode = useRef(panel.mode)
  useEffect(() => {
    const was = previousMode.current
    previousMode.current = panel.mode
    if (was === 'day' || panel.mode !== 'day') return
    const origin = lastOrigin.current
    const id = window.setTimeout(() => {
      const root = rootRef.current
      if (!root) return
      const scope =
        origin?.from === 'panel'
          ? root.querySelector('section')
          : root.querySelector('[role="grid"]')
      const row = origin
        ? scope?.querySelector<HTMLElement>(`[data-event-id="${origin.eventId}"]`)
        : null
      const cell = root.querySelector<HTMLElement>(`[data-day="${selected}"]`)
      ;(row ?? cell)?.focus()
    }, 130)
    return () => window.clearTimeout(id)
    // Runs on a change of mode only; `selected` is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.mode])

  /* --- Announcements ----------------------------------------------------- */
  const [live, setLive] = useState('')
  const announce = useCallback((message: string) => {
    setLive('')
    window.setTimeout(() => setLive(message), 40)
  }, [])
  const dayLabel = `${dayTitle(selected, displayZone)}, ${
    dayEvents.length === 0
      ? 'no events'
      : `${String(dayEvents.length)} event${dayEvents.length === 1 ? '' : 's'}`
  }`
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (panel.mode === 'day') announce(dayLabel)
    // The day and its count, when the day changes or the panel returns to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, panel.mode === 'day'])
  useEffect(() => {
    if (panel.mode === 'event' && openEvent) announce(`${openEvent.title} opened`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.mode, openEventId])
  const period = view === 'month' ? monthOf(anchor) : view === 'week' ? weekDays(anchor)[0] : null
  useEffect(() => {
    if (firstRender.current || !period) return
    announce(view === 'month' ? monthTitle(anchor, displayZone) : weekTitle(anchor, displayZone))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  /* --- Handlers ---------------------------------------------------------- */
  const onSelectDay = useCallback(
    (day: DayKey) => dispatch({ type: 'SELECT_DAY', day }),
    [dispatch],
  )
  const onFocusDay = useCallback((day: DayKey) => dispatch({ type: 'FOCUS_DAY', day }), [dispatch])
  const onOpenEvent = useCallback(
    (event: CalendarEvent, from: Origin) => {
      const zone = event.allDay ? event.timezone : displayZone
      dispatch({ type: 'OPEN_EVENT', eventId: event.id, day: dayKeyOf(event.startsAt, zone), from })
    },
    [dispatch, displayZone],
  )
  const onCreateOn = useCallback(
    (day: DayKey) => dispatch({ type: 'START_CREATE', seed: seedFor(day, today) }),
    [dispatch, today],
  )
  const onEnterPanel = useCallback(() => {
    document.getElementById('calendar-panel-title')?.focus()
  }, [])
  const onNavigate = useCallback(
    (direction: -1 | 1, months = 1) => {
      for (let i = 0; i < months; i += 1) dispatch({ type: 'NAVIGATE', direction })
    },
    [dispatch],
  )
  const onToday = useCallback(() => dispatch({ type: 'TODAY', today }), [dispatch, today])
  const onDirtyChange = useCallback(
    (dirty: boolean) => dispatch({ type: 'SET_DIRTY', dirty }),
    [dispatch],
  )

  useKeyboardShortcut({ key: 'n', enabled: canCreate && canView }, (event) => {
    // The grid has its own N, on the focused day rather than the selected one.
    if ((event.target as HTMLElement | null)?.closest('[role="grid"]')) return
    dispatch({ type: 'START_CREATE', seed: seedFor(selected, today) })
  })

  async function onSubmit(values: EventFormValues): Promise<void> {
    if (!organization) return
    const input = toEventInput(values, organization.id)
    const day = dayKeyOf(input.startsAt, values.allDay ? values.timezone : displayZone)
    try {
      if (panel.mode === 'create') {
        const eventId = await mutations.create.mutateAsync(values)
        dispatch({ type: 'SAVED', eventId, day })
      } else if (openEvent) {
        quiet.current.add(openEvent.id)
        await mutations.update.mutateAsync({ event: openEvent, values })
        dispatch({ type: 'SAVED', eventId: openEvent.id, day })
      }
    } catch {
      // The mutation holds the error; the form shows it and stays open.
    }
  }

  async function onConfirmDelete(): Promise<void> {
    if (!openEvent) return
    expectRemoval.current = openEvent.id
    try {
      await mutations.remove.mutateAsync(openEvent)
      dispatch({ type: 'DELETED' })
      announce('Deleted')
    } catch {
      // Shown in the strip, which stays open.
    } finally {
      expectRemoval.current = null
    }
  }

  /* --- Render ------------------------------------------------------------ */
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-[1280px] px-4 py-4 sm:px-6">
        <ForbiddenState description="Your role does not include access to the calendar." />
      </div>
    )
  }

  const title =
    view === 'month'
      ? monthTitle(anchor, displayZone)
      : view === 'week'
        ? weekTitle(anchor, displayZone)
        : dayTitle(selected, displayZone)
  const showToday =
    view === 'month'
      ? monthOf(today) !== monthOf(anchor)
      : view === 'week'
        ? !weekDays(anchor).includes(today)
        : selected !== today

  const panelElement = (
    <CalendarContextPanel
      state={state}
      dispatch={dispatch}
      today={today}
      displayZone={displayZone}
      dayEvents={dayEvents}
      openEvent={openEvent}
      loading={query.isPending}
      highlight={highlight}
      flashes={flashes}
      canCreate={canCreate}
      mayChange={mayChange}
      reducedMotion={reducedMotion}
      saving={mutations.create.isPending || mutations.update.isPending}
      saveError={
        panel.mode === 'create'
          ? mutations.create.error
          : panel.mode === 'edit'
            ? mutations.update.error
            : null
      }
      deleting={mutations.remove.isPending}
      deleteError={state.confirmingDelete ? mutations.remove.error : null}
      staleEdit={staleEdit}
      reloadToken={reloadToken}
      onReloadForm={onReloadForm}
      onSubmit={(values) => void onSubmit(values)}
      onConfirmDelete={() => void onConfirmDelete()}
      onOpenEvent={onOpenEvent}
      onHighlight={onHighlight}
      onDirtyChange={onDirtyChange}
    />
  )

  return (
    <LazyMotion features={domAnimation} strict>
      <div ref={rootRef} className="relative flex h-full min-h-0 flex-col">
        <CalendarToolbar
          title={title}
          view={view}
          views={isDesktop ? DESKTOP_VIEWS : MOBILE_VIEWS}
          showToday={showToday}
          canCreate={canCreate}
          onSetView={(next) => dispatch({ type: 'SET_VIEW', view: next })}
          onStep={(direction) => onNavigate(direction)}
          onToday={onToday}
          onCreate={() => dispatch({ type: 'START_CREATE', seed: seedFor(selected, today) })}
        />

        <div className="flex min-h-0 flex-1">
          <div
            className={cn(
              'relative flex min-h-0 min-w-0 flex-1 flex-col',
              // Room beneath the grid for the sheet's peek on a phone.
              !isDesktop && 'pb-24',
            )}
          >
            {/* A refetch while something is already on screen: a 2px bar,
                never a blank grid. */}
            <div
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden transition-opacity duration-[120ms]',
                query.isFetching && !query.isPending ? 'opacity-100' : 'opacity-0',
              )}
            >
              <span className="bg-primary calendar-route-bar absolute inset-y-0 w-2/5 shadow-[0_0_8px_rgb(102_86_240/0.6)]" />
            </div>

            {query.isPending ? (
              <CalendarSkeleton />
            ) : query.isError ? (
              <div className="p-5">
                <ErrorState error={query.error} onRetry={() => void query.refetch()} />
              </div>
            ) : view === 'month' ? (
              <MonthView
                anchor={anchor}
                today={today}
                selected={selected}
                focused={state.focused}
                currentEventId={panel.mode === 'day' ? null : openEventId}
                highlight={highlight}
                flashes={flashes}
                byDay={byDay}
                displayZone={displayZone}
                canCreate={canCreate}
                direction={state.gridDirection}
                reducedMotion={reducedMotion}
                onSelectDay={onSelectDay}
                onFocusDay={onFocusDay}
                onOpenEvent={onOpenEvent}
                onCreateOn={onCreateOn}
                onHighlight={onHighlight}
                onNavigate={onNavigate}
                onToday={onToday}
                onEnterPanel={onEnterPanel}
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <TimeGrid
                  days={days}
                  today={today}
                  events={events}
                  displayZone={displayZone}
                  onOpenEvent={(event) => onOpenEvent(event, 'grid')}
                />
              </div>
            )}

            {/* The zone everything above is read in, said once. */}
            <p className="text-3xs text-muted-foreground border-border-subtle shrink-0 border-t px-5 py-1.5 font-mono">
              Times shown in {displayZone}
            </p>
          </div>

          {isDesktop ? (
            <aside className="border-border w-80 shrink-0 border-l xl:w-[360px]">
              {panelElement}
            </aside>
          ) : null}
        </div>

        {isDesktop ? null : (
          <MobileContextSheet
            snap={state.sheet}
            collapsible={panel.mode === 'day'}
            reducedMotion={reducedMotion}
            onSnap={(snap) => dispatch({ type: 'SET_SHEET', snap })}
            onDismiss={() => dispatch({ type: 'BACK' })}
          >
            {panelElement}
          </MobileContextSheet>
        )}

        <div aria-live="polite" className="sr-only">
          {live}
        </div>
      </div>
    </LazyMotion>
  )
}

/**
 * Where a new event on a day starts.
 *
 * The next whole hour if the day is today, so "new event" is not in the past
 * the moment it opens; seven in the evening otherwise, which is when this
 * organization's things tend to happen. Two hours long either way.
 */
function seedFor(day: DayKey, today: DayKey): { day: DayKey; startTime: string; endTime: string } {
  let hour = 19
  if (day === today) hour = Math.min(22, new Date().getHours() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { day, startTime: `${pad(hour)}:00`, endTime: `${pad(Math.min(23, hour + 2))}:00` }
}

/** The shape of the thing that is coming, not a spinner. */
function CalendarSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-px p-1" aria-busy="true">
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} className="flex min-h-[84px] flex-1 gap-px">
          {Array.from({ length: 7 }, (_, column) => (
            <Skeleton key={column} className="flex-1 rounded-xs" />
          ))}
        </div>
      ))}
    </div>
  )
}
