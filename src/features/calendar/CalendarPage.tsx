import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarBlank, CaretLeft, CaretRight, Plus } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Can } from '@/components/common/Can'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState, ErrorState, ForbiddenState } from '@/components/common/states'
import { Skeleton } from '@/components/ui/skeleton'
import { profileService } from '@/services/profile.service'
import type { CalendarEvent } from '@/services/calendar.service'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { detectTimezone } from '@/utils/datetime'
import { cn } from '@/lib/utils'
import {
  addDays,
  addMonths,
  dayTitle,
  monthGridDays,
  monthTitle,
  rangeForDays,
  startOfWeek,
  todayKey,
  weekDays,
  weekTitle,
  type DayKey,
} from './calendar-time'
import { useCalendarEvents } from './use-calendar-events'
import { useCalendarRealtime } from './use-calendar-realtime'
import { MonthView } from './MonthView'
import { TimeGrid } from './TimeGrid'
import { EventDetailDialog } from './EventDetailDialog'
import { CreateEventDialog } from './CreateEventDialog'
import { EditEventDialog } from './EditEventDialog'
import { DeleteEventDialog } from './DeleteEventDialog'

/**
 * The organization's calendar.
 *
 * Three views over one question — what is happening between these two instants
 * — and the view decides the window rather than the other way round. Whatever
 * is on screen is exactly what was asked for: a month grid fetches its six
 * weeks including the days either side of the month, a week fetches its seven
 * days, a day fetches one.
 *
 * WHICH CLOCK. Events are stored as instants, so a calendar has to choose a
 * zone to read them in, and this reads them in the viewer's — their profile
 * timezone, which the profile dialog already describes as "used to show
 * schedules in your local time", then the organization's, then the browser's.
 * A scrim booked for 20:00 in Jakarta shows as 20:00 to somebody in Jakarta
 * and as 14:00 to somebody in Berlin, which is the same moment and the point
 * of storing an instant. Where the two differ, the event's own zone is shown
 * beside the time in its detail.
 *
 * All-day events are the exception, and deliberately: they are placed by the
 * zone they were written in, because "the bootcamp is on the 5th" is the 5th
 * wherever it is read. Placing them by the reader's zone is how an all-day
 * event slides onto the previous day for half an organization.
 *
 * Which day and which view are local state. Nothing about a calendar's
 * position is worth persisting, and the events themselves live in TanStack
 * Query rather than in a store.
 */

type View = 'month' | 'week' | 'day'

const VIEWS: { id: View; label: string; short: string }[] = [
  { id: 'month', label: 'Month', short: 'M' },
  { id: 'week', label: 'Week', short: 'W' },
  { id: 'day', label: 'Day', short: 'D' },
]

export function CalendarPage() {
  const { organization } = useWorkspace()
  const canView = usePermission('calendar.view')

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
  // calendar at all: there is no sense opening a socket for one who would
  // receive nothing but empty envelopes.
  useCalendarRealtime(canView ? organization?.id : undefined)

  const today = todayKey(displayZone)
  const [view, setView] = useState<View>('month')
  const [anchor, setAnchor] = useState<DayKey>(today)
  const [openEvent, setOpenEvent] = useState<CalendarEvent | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null)

  // The zone arrives late: the profile is a query, so the first render falls
  // back to the organization's and the anchor is chosen in that. Where the two
  // disagree about what day it is — a UTC profile read from Jakarta, in the
  // seven hours between their midnights — the calendar would sit on one day
  // and mark another as today. So follow the zone, unless the reader has
  // already moved somewhere of their own.
  const anchoredIn = useRef(displayZone)
  useEffect(() => {
    if (anchoredIn.current === displayZone) return
    const before = todayKey(anchoredIn.current)
    anchoredIn.current = displayZone
    setAnchor((current) => (current === before ? todayKey(displayZone) : current))
  }, [displayZone])

  // The days on screen, which are also the query's window.
  const days = useMemo(() => {
    if (view === 'month') return monthGridDays(anchor)
    if (view === 'week') return weekDays(anchor)
    return [anchor]
  }, [view, anchor])

  const range = useMemo(() => rangeForDays(days, displayZone), [days, displayZone])
  const query = useCalendarEvents(canView ? organization?.id : undefined, range)

  const title =
    view === 'month'
      ? monthTitle(anchor, displayZone)
      : view === 'week'
        ? weekTitle(anchor, displayZone)
        : dayTitle(anchor, displayZone)

  function step(direction: -1 | 1): void {
    setAnchor((current) =>
      view === 'month'
        ? addMonths(current, direction)
        : addDays(current, direction * (view === 'week' ? 7 : 1)),
    )
  }

  /** Opening a day from the month grid is how you get to the day view. */
  function openDay(day: DayKey): void {
    setAnchor(day)
    setView('day')
  }

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-[1280px] px-4 py-4 sm:px-6">
        <ForbiddenState description="Your role does not include access to the calendar." />
      </div>
    )
  }

  const events = query.data ?? []

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4 px-4 pt-4 pb-8 sm:px-6 sm:pt-5">
      <PageHeader
        eyebrow="Schedule"
        title="Calendar"
        description={`Scrims, matches and meetings in ${organization?.name ?? 'your organization'}.`}
        actions={
          // Hidden rather than disabled, as every other permission-gated
          // action in this application is. The database refuses it either way.
          <Can perm="calendar.create">
            <Button
              onClick={() => {
                setCreating(true)
              }}
            >
              <Plus aria-hidden="true" />
              New event
            </Button>
          </Can>
        }
      />

      {/* --- The bar: where you are, and how you are looking at it --------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Previous ${view}`}
            onClick={() => step(-1)}
          >
            <CaretLeft aria-hidden="true" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Next ${view}`}
            onClick={() => step(1)}
          >
            <CaretRight aria-hidden="true" />
          </Button>
        </div>

        {/* The period on screen. `aria-live` so stepping through months says
            where it landed rather than silently redrawing. */}
        <h2 aria-live="polite" className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          {title}
        </h2>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setAnchor(today)
          }}
          disabled={anchor === today}
        >
          Today
        </Button>

        {/* --- The view switcher: a segmented control at the system's size -- */}
        <div
          role="group"
          aria-label="Calendar view"
          className="border-border bg-elevated flex shrink-0 overflow-hidden rounded-sm border"
        >
          {VIEWS.map((option, index) => {
            const active = view === option.id
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                // Named in full whatever is drawn: the label shortens to a
                // letter on a phone, and "M" is not a word anybody can act on.
                aria-label={option.label}
                onClick={() => {
                  // Switching keeps the day you were looking at: a week
                  // becomes the week around it, a month the month around it.
                  setView(option.id)
                  if (option.id === 'week') setAnchor((current) => startOfWeek(current))
                }}
                className={cn(
                  'border-border text-2xs h-7 px-2.5 transition-colors duration-[120ms] sm:px-3',
                  index > 0 && 'border-l',
                  active
                    ? 'bg-surface-active text-accent-text font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <span className="hidden sm:inline">{option.label}</span>
                <span className="font-mono sm:hidden">{option.short}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* --- The calendar ------------------------------------------------- */}
      {query.isPending ? (
        <CalendarSkeleton view={view} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {view === 'month' ? (
            <MonthView
              anchor={anchor}
              today={today}
              events={events}
              displayZone={displayZone}
              onOpenEvent={setOpenEvent}
              onOpenDay={openDay}
            />
          ) : (
            <div className="overflow-x-auto">
              <TimeGrid
                days={days}
                today={today}
                events={events}
                displayZone={displayZone}
                onOpenEvent={setOpenEvent}
              />
            </div>
          )}

          {events.length === 0 ? (
            <EmptyState
              icon={CalendarBlank}
              title="No events scheduled."
              description={`Nothing is on the calendar for this ${view}.`}
            />
          ) : null}
        </>
      )}

      {/* The zone everything above is read in, said once. */}
      <p className="text-2xs text-muted-foreground font-mono">Times shown in {displayZone}</p>

      <EventDetailDialog
        event={openEvent}
        displayZone={displayZone}
        onClose={() => {
          setOpenEvent(null)
        }}
        // The detail hands the event over and closes: two dialogs open at once
        // is two focus traps arguing.
        onEdit={(event) => {
          setOpenEvent(null)
          setEditing(event)
        }}
        onDelete={(event) => {
          setOpenEvent(null)
          setDeleting(event)
        }}
      />

      <EditEventDialog
        event={editing}
        timezone={displayZone}
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
      />

      <DeleteEventDialog
        event={deleting}
        onOpenChange={(next) => {
          if (!next) setDeleting(null)
        }}
        onDeleted={() => {
          setDeleting(null)
        }}
      />

      {/* Scheduled where the calendar is looking: the day on screen, in the
          zone it is being read in. */}
      {organization ? (
        <CreateEventDialog
          open={creating}
          onOpenChange={setCreating}
          organizationId={organization.id}
          day={anchor}
          timezone={displayZone}
        />
      ) : null}
    </div>
  )
}

/** The shape of the thing that is coming, not a spinner. */
function CalendarSkeleton({ view }: { view: View }) {
  return (
    <div className="border-border bg-card space-y-px overflow-hidden rounded-md border p-1">
      {Array.from({ length: view === 'month' ? 6 : 8 }, (_, row) => (
        <div key={row} className="flex gap-px">
          {Array.from({ length: view === 'day' ? 1 : 7 }, (_, column) => (
            <Skeleton key={column} className="h-[72px] flex-1 rounded-sm" />
          ))}
        </div>
      ))}
    </div>
  )
}
