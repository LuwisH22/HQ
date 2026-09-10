import { queryKeys } from '@/lib/query-keys'
import { elsewhere, fieldOf, type Change } from '@/lib/realtime-feed'

export type { Change } from '@/lib/realtime-feed'

/**
 * What a change to a team means for the caches.
 *
 * Kept apart from the socket, like the projects router it is modelled on:
 * deciding which family a row belongs to is the part of realtime that goes
 * quietly wrong, and it is arithmetic on a payload, so it can be read and
 * tested without a connection.
 *
 * Nothing here puts a payload into a cache. A change is news that something
 * happened; the query that follows decides what, and goes through RLS like
 * every other read. That is what keeps realtime from becoming a second,
 * unpoliced way to read the database — and it is why a roster row's position
 * and status never need to be trusted from the wire.
 */

export interface Refresh {
  /** Families to invalidate at once. */
  keys: readonly (readonly unknown[])[]
}

const NOTHING: Refresh = { keys: [] }

/**
 * One open team: the team itself, and who is on it.
 *
 * Everyone in an organization who may view teams may view all of them, so this
 * topic hears about teams that are not on screen. Discarding those here is
 * what stops a roster change two teams away redrawing this one.
 */
export function routeTeamChange(
  change: Change,
  scope: { organizationId: string; teamId: string },
): Refresh {
  const { organizationId: org, teamId } = scope

  switch (change.table) {
    case 'teams': {
      if (elsewhere(fieldOf(change, 'organization_id'), org)) return NOTHING

      // The list is behind whichever team changed — a rename, an archive or a
      // restore all move a row between its groups. This team's own header is
      // behind only if it was this one.
      const keys: (readonly unknown[])[] = [queryKeys.teams.list(org)]
      if (!elsewhere(fieldOf(change, 'id'), teamId)) {
        keys.push(queryKeys.teams.detail(org, teamId))
      }
      return { keys }
    }

    case 'team_members': {
      // A roster row names its team in every payload, including a delete: the
      // primary key is the pair, so replica identity default is enough to
      // place a removal precisely.
      if (elsewhere(fieldOf(change, 'team_id'), teamId)) return NOTHING

      return {
        keys: [
          queryKeys.teams.members(org, teamId),
          // The head count and the faces the list draws.
          queryKeys.teams.detail(org, teamId),
          queryKeys.teams.rosters(org),
          queryKeys.teams.list(org),
        ],
      }
    }

    default:
      return NOTHING
  }
}

/**
 * The list of teams.
 *
 * It draws a name, an archived state, a head count and a few faces — so it
 * hears about both tables, but never about a particular team's roster family,
 * which it does not hold.
 *
 * A move is two rows in two teams and arrives as two events. Neither is
 * special-cased: each invalidates the same families, and the refetch that
 * follows is what settles where somebody ended up. There is nothing to
 * reconstruct and nothing to merge.
 */
export function routeTeamsListChange(change: Change, organizationId: string): Refresh {
  switch (change.table) {
    case 'teams': {
      if (elsewhere(fieldOf(change, 'organization_id'), organizationId)) return NOTHING
      return { keys: [queryKeys.teams.list(organizationId)] }
    }

    case 'team_members': {
      // No organization on a roster row, and the list has no one team to
      // compare it against. Both families it draws from are refreshed, which
      // for a list this size is one small read each.
      return {
        keys: [queryKeys.teams.rosters(organizationId), queryKeys.teams.list(organizationId)],
      }
    }

    default:
      return NOTHING
  }
}
