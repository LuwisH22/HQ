import { queryKeys } from '@/lib/query-keys'
import { elsewhere, fieldOf, type Change } from '@/lib/realtime-feed'

export type { Change, ChangedRow } from '@/lib/realtime-feed'

/**
 * What a change to the database means for the caches.
 *
 * Kept apart from the socket on purpose. Deciding which query family a row
 * belongs to is the part of realtime that is easy to get quietly wrong — too
 * broad and every keystroke somewhere else redraws the board, too narrow and
 * the screen goes stale without saying so — and it is arithmetic on a payload,
 * so it can be read and tested without a connection.
 *
 * The socket itself, and the two questions every router asks of a payload,
 * live in `@/lib/realtime-feed` — shared with every other feature that
 * listens, so there is one way of doing this rather than one per feature.
 *
 * Nothing here ever puts a payload into a cache. A change is news that
 * something happened; the query that follows is what decides what, and it goes
 * through RLS like every other read. That is what keeps realtime from becoming
 * a second, unpoliced way to read the database.
 */

export interface Refresh {
  /** Families to invalidate at once. */
  keys: readonly (readonly unknown[])[]
  /**
   * Whether the open project's board is stale too.
   *
   * Named rather than listed among the keys, because it is the one family a
   * client may be holding an optimistic copy of — a card that has been dragged
   * but not yet confirmed — and so the one refresh that is ever worth
   * delaying. The caller holds the key and decides when.
   */
  board: boolean
}

const NOTHING: Refresh = { keys: [], board: false }

/**
 * One open project: the board, its roster, its labels and its conversations.
 *
 * Every member of an organization who may view projects may view all of them,
 * so this topic hears about projects that are not on screen. Discarding those
 * here is what keeps an edit two projects away from redrawing this one.
 */
export function routeProjectChange(
  change: Change,
  scope: { organizationId: string; projectId: string },
): Refresh {
  const { organizationId: org, projectId } = scope

  switch (change.table) {
    case 'projects': {
      if (elsewhere(fieldOf(change, 'organization_id'), org)) return NOTHING
      // The list is behind whichever project changed; this one's header is
      // behind only if it was this one.
      const keys: (readonly unknown[])[] = [queryKeys.projects.list(org)]
      if (!elsewhere(fieldOf(change, 'id'), projectId)) {
        keys.push(queryKeys.projects.detail(org, projectId))
      }
      return { keys, board: false }
    }

    case 'project_members': {
      if (elsewhere(fieldOf(change, 'project_id'), projectId)) return NOTHING
      // The roster on screen, and the count the list draws beside each project.
      return {
        keys: [queryKeys.projects.members(org, projectId), queryKeys.projects.list(org)],
        board: false,
      }
    }

    case 'tasks': {
      if (elsewhere(fieldOf(change, 'project_id'), projectId)) return NOTHING
      return { keys: [], board: true }
    }

    case 'project_labels': {
      if (elsewhere(fieldOf(change, 'project_id'), projectId)) return NOTHING
      // The catalogue only. A card holds label ids and reads names from here,
      // so renaming a label does not make the board's rows wrong — and
      // deleting one takes its `task_labels` rows with it, which arrive on
      // their own and refresh the board then.
      return { keys: [queryKeys.projects.labels(org, projectId)], board: false }
    }

    case 'task_labels': {
      // The one row here that cannot be placed: it names a task and a label,
      // never a project, and a cache that does not hold the task cannot prove
      // the task is somebody else's rather than one created a moment ago. So
      // the board is refreshed either way. It costs one indexed read per label
      // put on or taken off anywhere in the organization, while a project is
      // open, which is a fair price for never dropping a real one.
      return { keys: [], board: true }
    }

    case 'project_review_comments': {
      if (elsewhere(fieldOf(change, 'project_id'), projectId)) return NOTHING
      // The review conversation only. Saying something about a project does
      // not move it along, so neither the header nor the board is stale.
      return { keys: [queryKeys.projects.review(org, projectId)], board: false }
    }

    case 'task_comments': {
      const taskId = fieldOf(change, 'task_id')
      // Keyed by the task, so a comment on a task nobody has open invalidates
      // a query with no observer and nothing refetches. A soft delete carries
      // its task like any update; a real delete — a cascade when the task
      // itself goes — carries only an id, and the whole comment prefix is
      // cheap to mark stale because at most one task's comments are on screen.
      return {
        keys: [
          taskId ? queryKeys.projects.comments(org, taskId) : queryKeys.projects.commentsAll(org),
        ],
        board: false,
      }
    }

    default:
      return NOTHING
  }
}

/**
 * The list of projects.
 *
 * A narrower topic for a narrower page: what changed about a project, and how
 * many people are on it, because the list draws that count.
 */
export function routeProjectsListChange(change: Change, organizationId: string): Refresh {
  switch (change.table) {
    case 'projects': {
      if (elsewhere(fieldOf(change, 'organization_id'), organizationId)) return NOTHING
      return { keys: [queryKeys.projects.list(organizationId)], board: false }
    }

    case 'project_members': {
      // No organization on the row and no project on screen to compare it to.
      // One refetch of a list this small is cheaper than the machinery that
      // would be needed to find out.
      return { keys: [queryKeys.projects.list(organizationId)], board: false }
    }

    case 'tasks': {
      // Not the board — the list does not draw one. Who is working on a
      // project is derived from assignment, and how much is left from status,
      // so a task changing anywhere in the organization is exactly what makes
      // a row of avatars or a count on this page wrong. The overview is its
      // own family precisely so this does not refetch every project as well.
      return { keys: [queryKeys.projects.overview(organizationId)], board: false }
    }

    default:
      return NOTHING
  }
}
