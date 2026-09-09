import type { ProjectStatus } from '@/types/database.types'

/**
 * Where a project has got to, and where it may go next.
 *
 * Four stages in one order, which is the whole point: 6.1's status was a label
 * anybody could set to anything, so a project could be marked finished without
 * ever having been started or reviewed. The database now owns the order and
 * refuses the jumps; this file is the same order written where the screen can
 * read it, so a button that cannot work is never drawn in the first place.
 *
 * Archived is deliberately absent. It is not a stage — a project is at a stage
 * and separately either put away or not — and adding it back here would
 * recreate exactly the confusion this phase removed.
 */
export const PROJECT_STATUSES = ['planned', 'in_progress', 'in_review', 'done'] as const

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
}

/**
 * The stages a project may be created at.
 *
 * The beginning, or already under way for work that was happening before
 * anybody wrote it down. Not review, and not done: those are places the
 * workflow arrives at, and starting there would be the jump the lifecycle
 * exists to prevent. The routine refuses them too.
 */
export const SELECTABLE_STATUSES = ['planned', 'in_progress'] as const

/** How far along a stage is, for drawing the track. Planned is step one. */
export function stageIndex(status: ProjectStatus): number {
  return PROJECT_STATUSES.indexOf(status)
}

/*
 * There is deliberately no table of allowed moves here.
 *
 * `transition_project` owns the rules, and a copy of them in TypeScript would
 * be a second statement of the same thing that nothing keeps in step — it
 * would pass its own tests while disagreeing with the database, which is the
 * worst of both. What the screen needs is not "which moves are legal" but
 * "which button belongs at this stage", and that is a handful of named actions
 * in `ProjectWorkflow`, each of which the routine re-checks anyway.
 *
 * The four moves and the refusals are exercised where they are decided, by
 * `scripts/verify-project-lifecycle.mjs`, against the live routine.
 */

/**
 * How long a review may run.
 *
 * A short list rather than any number of minutes, matching
 * `assert_valid_review_duration`. Somebody typing 7 into a box means "a week"
 * and would get seven minutes; the lengths people actually pick are hours.
 * Null is a real answer here — a review with nothing to race.
 */
export const REVIEW_DURATIONS: readonly { minutes: number | null; label: string }[] = [
  { minutes: null, label: 'No limit' },
  { minutes: 60, label: '1 hour' },
  { minutes: 240, label: '4 hours' },
  { minutes: 720, label: '12 hours' },
  { minutes: 1440, label: '24 hours' },
  { minutes: 2880, label: '48 hours' },
  { minutes: 4320, label: '72 hours' },
]

/** The value the duration select carries, since a select cannot hold null. */
export const NO_REVIEW_LIMIT = 'none'

export function durationFromValue(value: string): number | null {
  return value === NO_REVIEW_LIMIT ? null : Number(value)
}

export function valueFromDuration(minutes: number | null): string {
  return minutes === null ? NO_REVIEW_LIMIT : String(minutes)
}
