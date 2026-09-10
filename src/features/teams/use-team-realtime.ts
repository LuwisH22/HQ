import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { invalidateKeys, useChangeFeed } from '@/lib/realtime-feed'
import { routeTeamChange, routeTeamsListChange } from './team-realtime'

/**
 * Teams, kept current while somebody is looking at them.
 *
 * The socket is the shared one in `@/lib/realtime-feed` — the same the
 * calendar has used since 5.3C and projects since 6.4 — so there is one
 * realtime architecture in this application rather than one per feature. What
 * belongs here is which tables a team is made of and which families a change
 * makes stale.
 *
 * Nothing is deferred or reconciled, and that is not an omission. Every team
 * and roster mutation is non-optimistic by design: 7.2 and 7.3 chose to wait
 * for the routine rather than show a change the server had not agreed to, so
 * there is no local copy for an arriving event to fight with. The projects
 * board needs a deferral because a dragged card is optimistic; a roster has
 * nothing to protect, and adding the machinery anyway would be cargo.
 */

/** Everything one open team is made of. */
const TEAM_TABLES = ['teams', 'team_members'] as const

/** What the list draws: the teams, and the rosters behind its counts and faces. */
const LIST_TABLES = ['teams', 'team_members'] as const

/**
 * One open team.
 *
 * `enabled` carries the permission, so losing `teams.view` closes the socket
 * rather than merely hiding the page — and the refetch that any surviving
 * query makes still goes through RLS, which is what actually decides whether
 * a roster is still readable.
 */
export function useTeamRealtime(
  organizationId: string | undefined,
  teamId: string | undefined,
  enabled = true,
): void {
  const queryClient = useQueryClient()
  // The same stand-in the queries use when they are disabled, so the keys
  // built here and the keys built there are one set of keys.
  const org = organizationId ?? 'none'
  const team = teamId ?? 'none'

  useChangeFeed(
    `team:${team}`,
    TEAM_TABLES,
    Boolean(organizationId) && Boolean(teamId) && enabled,
    (change) => {
      invalidateKeys(queryClient, routeTeamChange(change, { organizationId: org, teamId: team }).keys)
    },
    () => {
      // A fresh connection has missed whatever happened while it was gone and
      // has no way to find out what. Everything this topic covers is marked
      // stale; only what is actually on screen pays for it.
      invalidateKeys(queryClient, [
        queryKeys.teams.detail(org, team),
        queryKeys.teams.members(org, team),
        queryKeys.teams.rosters(org),
        queryKeys.teams.list(org),
      ])
    },
  )
}

/**
 * The list of teams.
 *
 * Its own topic rather than a share of the team one: the two pages want
 * different things, and a list open on a phone has no reason to hold a
 * subscription scoped to a team nobody is looking at.
 */
export function useTeamsRealtime(organizationId: string | undefined, enabled = true): void {
  const queryClient = useQueryClient()
  const org = organizationId ?? 'none'

  useChangeFeed(
    `teams:${org}`,
    LIST_TABLES,
    Boolean(organizationId) && enabled,
    (change) => {
      invalidateKeys(queryClient, routeTeamsListChange(change, org).keys)
    },
    () => {
      invalidateKeys(queryClient, [queryKeys.teams.list(org), queryKeys.teams.rosters(org)])
    },
  )
}
