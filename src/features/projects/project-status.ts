import type { ProjectStatus } from '@/types/database.types'

/**
 * The four states a project can be in, and how they are named on screen.
 *
 * A label and an order, and nothing else: no policy, routine or client check
 * reads any of this to decide what anybody may do. `archived` is the only one
 * that means anything beyond a word, and what it means lives in the routine
 * that puts a project there.
 */
export const PROJECT_STATUSES = ['planned', 'active', 'completed', 'archived'] as const

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
}

/**
 * The order the list groups them in: what is happening, what is about to, what
 * is finished, and what has been put away.
 */
export const PROJECT_STATUS_ORDER = ['active', 'planned', 'completed', 'archived'] as const

/**
 * The statuses somebody may choose in a form.
 *
 * Archiving is a separate action with its own permission, so it is not an
 * option in the dropdown — a status select that could quietly archive
 * something would be an authorization decision hidden in a field.
 */
export const SELECTABLE_STATUSES = ['planned', 'active', 'completed'] as const
