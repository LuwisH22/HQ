import { Check } from '@phosphor-icons/react'
import type { ProjectStatus } from '@/types/database.types'
import { cn } from '@/lib/utils'
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES, stageIndex } from './project-status'

/**
 * Where a project has got to, drawn.
 *
 * Four dots and three hairlines: passed stages are ticked, the current one is
 * filled, the ones ahead are open rings. No progress bar, no gradient, no
 * glow — the information is which of four words applies, and a bar would be a
 * decoration pretending to be a measurement.
 *
 * The state is never carried by colour alone. Every stage keeps its name
 * beside it at full size, the marks differ in shape as well as tone, and the
 * whole thing is announced as one sentence rather than as four unrelated
 * labels — a screen reader hears "Stage 2 of 4: In progress", not "tick tick
 * circle circle".
 */
export function LifecycleTrack({
  status,
  compact = false,
  className,
}: {
  status: ProjectStatus
  /** The list's version: marks and hairlines, names only where there is room. */
  compact?: boolean
  className?: string
}) {
  const at = stageIndex(status)

  return (
    // `overflow-hidden` rather than trusting every child to shrink: a track
    // that runs out of room should lose the ends of its words, not draw over
    // whatever is beside it.
    <div className={cn('flex items-center overflow-hidden', className)}>
      {/*
        One sentence for anybody not looking at the marks. The visual track
        below it is hidden from the reading order rather than duplicated into
        it, which is what turns four decorations into one fact.
      */}
      <span className="sr-only">
        {`Stage ${String(at + 1)} of ${String(PROJECT_STATUSES.length)}: ${PROJECT_STATUS_LABELS[status]}`}
      </span>

      <ol aria-hidden="true" className="flex min-w-0 flex-1 items-center">
        {PROJECT_STATUSES.map((stage, index) => {
          const passed = index < at
          const here = index === at

          return (
            <li
              key={stage}
              className={cn('flex min-w-0 items-center', index === 0 ? '' : 'flex-1')}
            >
              {index === 0 ? null : (
                <span
                  className={cn(
                    'mx-1.5 h-px min-w-3 flex-1',
                    passed || here ? 'bg-border-strong' : 'bg-border-subtle',
                  )}
                />
              )}

              <span className="flex min-w-0 items-center gap-1.5">
                {passed ? (
                  <Check
                    weight="bold"
                    className="text-muted-foreground size-3 shrink-0"
                  />
                ) : (
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      here
                        ? 'bg-primary ring-primary/25 ring-2'
                        : 'border-border-strong border bg-transparent',
                    )}
                  />
                )}

                <span
                  className={cn(
                    'text-3xs truncate',
                    here ? 'text-foreground font-medium' : 'text-muted-foreground',
                    // Below the widest phones there is not room for four names
                    // and three rules, so the ones that are not the answer
                    // step aside and the marks carry the shape.
                    compact && !here ? 'hidden sm:inline' : '',
                  )}
                >
                  {PROJECT_STATUS_LABELS[stage]}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
