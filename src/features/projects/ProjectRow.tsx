import { Link } from 'react-router-dom'
import { Archive, CaretRight, Users } from '@phosphor-icons/react'
import type { Project, ProjectOverview } from '@/services/project.service'
import { formatDate } from '@/utils/datetime'
import { cn } from '@/lib/utils'
import { dateRange } from './project-dates'
import { LifecycleTrack } from './LifecycleTrack'
import { WorkerAvatars } from './WorkerAvatars'
import { ReviewCountdown } from './ReviewCountdown'

/**
 * One project, as a row rather than a card.
 *
 * A list of projects is a list: a card grid turns six things into a wall and
 * makes the seventh look like a gap.
 *
 * The row answers four questions in the order somebody actually asks them —
 * what is it, how far along is it, who is carrying it, and how much is left.
 * Before 6.5 it answered the first and then said "6 members", which is the
 * roster rather than the work: a project can be for six people while two of
 * them are doing anything. So the count stays, quietly, and who is actually
 * on it is what gets the space.
 */
export function ProjectRow({
  project,
  overview,
}: {
  project: Project
  /** Absent while the counts are still loading; the row draws without them. */
  overview: ProjectOverview | undefined
}) {
  const dates = dateRange(project.startDate, project.dueDate)
  const archived = project.archivedAt !== null

  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className={cn(
          'group border-border-subtle bg-surface hover:border-border-strong hover:bg-elevated',
          'flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-[120ms]',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          archived ? 'opacity-70' : '',
        )}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="truncate text-sm font-medium">{project.name}</p>
            {archived ? (
              <span className="text-3xs text-muted-foreground/70 inline-flex shrink-0 items-center gap-1">
                <Archive aria-hidden="true" className="size-3" />
                Archived
              </span>
            ) : null}
          </div>

          {/*
            The track, on every row including archived ones: where a project
            got to is exactly what archiving used to destroy.
          */}
          <LifecycleTrack status={project.status} compact className="max-w-md" />

          {project.status === 'in_review' && !archived ? (
            <ReviewCountdown deadline={project.reviewDeadlineAt} className="block" />
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <WorkerAvatars workers={overview?.workers ?? []} />

            <p className="text-3xs text-muted-foreground/70 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono">
              {overview ? (
                <span>
                  {`${String(overview.totalTasks)} task${overview.totalTasks === 1 ? '' : 's'}`}
                  {overview.doneTasks > 0 ? ` · ${String(overview.doneTasks)} done` : ''}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" aria-hidden="true" />
                {project.memberCount}
              </span>
              {dates ? <span className="hidden sm:inline">{dates}</span> : null}
              <span className="hidden md:inline">Updated {formatDate(project.updatedAt)}</span>
            </p>
          </div>
        </div>

        <CaretRight
          className="text-muted-foreground/50 group-hover:text-muted-foreground mt-1 size-3.5 shrink-0 transition-colors"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}
