import { CaretLeft, CaretRight, Plus } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { View } from './calendar-workspace-state'

/**
 * Where the calendar is, and how it is being looked at.
 *
 * One row: the period as the page's title, the two arrows around a Today
 * button that only appears when today is out of the window, the view
 * switcher, and New. New is here as well as in the panel because the toolbar
 * is where people look first and the panel is where they are when they
 * decide; both act on the selected day.
 */
export function CalendarToolbar({
  title,
  view,
  views,
  showToday,
  canCreate,
  onSetView,
  onStep,
  onToday,
  onCreate,
}: {
  title: string
  view: View
  views: readonly { id: View; label: string }[]
  showToday: boolean
  canCreate: boolean
  onSetView: (view: View) => void
  onStep: (direction: -1 | 1) => void
  onToday: () => void
  onCreate: () => void
}) {
  const period = view === 'month' ? 'month' : view === 'week' ? 'week' : 'day'

  return (
    <div className="border-border-subtle flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 sm:px-5">
      <h1 className="min-w-0 truncate text-[22px] leading-7 font-semibold tracking-[-0.01em]">
        {title}
      </h1>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Previous ${period}`}
          onClick={() => onStep(-1)}
        >
          <CaretLeft aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onToday}
          className={cn(!showToday && 'invisible')}
          tabIndex={showToday ? 0 : -1}
          aria-hidden={!showToday}
        >
          Today
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Next ${period}`}
          onClick={() => onStep(1)}
        >
          <CaretRight aria-hidden="true" />
        </Button>
      </div>

      <div className="flex-1" />

      {/* The view switcher: a segmented control at the system's size. */}
      <div
        role="group"
        aria-label="Calendar view"
        className="border-border bg-elevated flex h-7 shrink-0 rounded-sm border p-0.5"
      >
        {views.map((option) => {
          const active = view === option.id
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSetView(option.id)}
              className={cn(
                'text-2xs h-full rounded-xs px-2.5 font-medium transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
                active
                  ? 'bg-surface-active text-accent-text'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      {canCreate ? (
        <Button size="sm" onClick={onCreate} className="hidden md:inline-flex">
          <Plus aria-hidden="true" />
          New event
        </Button>
      ) : null}
    </div>
  )
}
