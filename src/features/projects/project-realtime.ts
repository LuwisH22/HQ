import { queryKeys } from '@/lib/query-keys'

/**
 * What a change to the database means for the caches.
 *
 * Kept apart from the socket on purpose. Deciding which query family a row
 * belongs to is the part of realtime that is easy to get quietly wrong — too
 * broad and every keystroke somewhere else redraws the board, too narrow and
 * the screen goes stale without saying so — and it is arithmetic on a payload,
 * so it can be read and tested without a connection.
 *
 * Nothing here ever puts a payload into a cache. A change is news that
 * something happened; the query that follows is what decides what, and it goes
 * through RLS like every other read. That is what keeps realtime from becoming
 * a second, unpoliced way to read the database.
 */

/** A row as Postgres Changes delivers it: some columns, or for a delete, an id. */
export type ChangedRow = Record<string, unknown> | null | undefined

export interface Change {
  table: string
  new: ChangedRow
  old: ChangedRow
}

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

/** A column from whichever half of the payload carries it. */
function field(change: Change, name: string): string | undefined {
  const fresh = change.new?.[name]
  if (typeof fresh === 'string') return fresh
  const stale = change.old?.[name]
  return typeof stale === 'string' ? stale : undefined
}

/**
 * Whether a row belongs to somewhere else.
 *
 * Deliberately one-sided. A delete arrives as a primary key and nothing more —
 * replica identity is default, which is the smallest thing the database can
 * say and all a client that refetches needs — so `undefined` means "cannot
 * tell", and cannot-tell is treated as ours. The refetch that follows is
 * scoped by RLS, so guessing wrong costs one read of rows the reader may
 * already see; guessing the other way would leave the screen wrong.
 */
function elsewhere(value: string | undefined, mine: string): boolean {
  return typeof value === 'string' && value !== mine
}

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
      if (elsewhere(field(change, 'organization_id'), org)) return NOTHING
      // The list is behind whichever project changed; this one's header is
      // behind only if it was this one.
      const keys: (readonly unknown[])[] = [queryKeys.projects.list(org)]
      if (!elsewhere(field(change, 'id'), projectId)) {
        keys.push(queryKeys.projects.detail(org, projectId))
      }
      return { keys, board: false }
    }

    case 'project_members': {
      if (elsewhere(field(change, 'project_id'), projectId)) return NOTHING
      // The roster on screen, and the count the list draws beside each project.
      return {
        keys: [queryKeys.projects.members(org, projectId), queryKeys.projects.list(org)],
        board: false,
      }
    }

    case 'tasks': {
      if (elsewhere(field(change, 'project_id'), projectId)) return NOTHING
      return { keys: [], board: true }
    }

    case 'project_labels': {
      if (elsewhere(field(change, 'project_id'), projectId)) return NOTHING
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

    case 'task_comments': {
      const taskId = field(change, 'task_id')
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
      if (elsewhere(field(change, 'organization_id'), organizationId)) return NOTHING
      return { keys: [queryKeys.projects.list(organizationId)], board: false }
    }

    case 'project_members': {
      // No organization on the row and no project on screen to compare it to.
      // One refetch of a list this small is cheaper than the machinery that
      // would be needed to find out.
      return { keys: [queryKeys.projects.list(organizationId)], board: false }
    }

    default:
      return NOTHING
  }
}
