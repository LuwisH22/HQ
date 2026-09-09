import { Link } from 'react-router-dom'
import { CaretRight, Users } from '@phosphor-icons/react'
import type { Project } from '@/services/project.service'
import { formatDate } from '@/utils/datetime'
import { cn } from '@/lib/utils'
import { dateRange } from './project-dates'

/**
 * One project, as a row rather than a card.
 *
 * A list of projects is a list: a card grid turns six things into a wall and
 * makes the seventh look like a gap. The whole row is the link, the metadata
 * is mono and quiet, and the only colour is the status when it is worth one.
 */
export function ProjectRow({ project }: { project: Project }) {
  const dates = dateRange(project.startDate, project.dueDate)

  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className={cn(
          'group border-border-subtle bg-surface hover:border-border-strong hover:bg-elevated',
          'flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors duration-[120ms]',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        )}
      >
        <div className="min-w-0 flex-1">
          {/* No status here: the list groups by it, and a row that repeats
              its own heading is noise on every line. */}
          <p className="truncate text-sm font-medium">{project.name}</p>

          <p className="text-2xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono">
            {dates ? <span>{dates}</span> : null}
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" aria-hidden="true" />
              {project.memberCount}
            </span>
            <span className="hidden sm:inline">Updated {formatDate(project.updatedAt)}</span>
          </p>
        </div>

        <CaretRight
          className="text-muted-foreground/50 group-hover:text-muted-foreground size-3.5 shrink-0 transition-colors"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}
