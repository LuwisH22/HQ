import type { RosterStatus } from '@/types/database.types'
import type { TeamMember } from '@/services/team.service'

/**
 * Whether somebody is starting, and what that is called on screen.
 *
 * Three values, and the third one is why there are three: a team that could
 * only say "on the roster" would have people removed to mean "not this split",
 * which loses the fact that they are on the team at all.
 *
 * None of this is an account state. `organization_members.status` decides
 * whether somebody may use LFG HQ — active, suspended, banned — and nothing
 * here is derived from it or can change it. The words are deliberately not the
 * same words for that reason: "Not playing" cannot be misread as "suspended",
 * and "Starting" cannot be misread as "active account".
 */
export const ROSTER_STATUSES = ['active', 'substitute', 'inactive'] as const

export const ROSTER_STATUS_LABELS: Record<RosterStatus, string> = {
  active: 'Starting',
  substitute: 'Substitute',
  inactive: 'Not playing',
}

/** The order a roster reads in: who is playing, then who is not. */
export function compareForRoster(a: TeamMember, b: TeamMember): number {
  const byStatus = ROSTER_STATUSES.indexOf(a.status) - ROSTER_STATUSES.indexOf(b.status)
  if (byStatus !== 0) return byStatus
  // Then by when they joined, which is stable and needs no stored order: a
  // roster is five to ten people and does not want a drag handle.
  return Date.parse(a.addedAt) - Date.parse(b.addedAt)
}

/** How many of a roster are actually playing. */
export function startingCount(members: readonly TeamMember[]): number {
  return members.filter((member) => member.status === 'active').length
}

/**
 * "5 members", or "5 members · 3 starting" when they are not all the same.
 *
 * The second half is only worth saying when it says something: a roster where
 * everybody is starting is fully described by its size.
 */
export function rosterSummary(members: readonly TeamMember[]): string {
  const total = members.length
  const size = `${String(total)} member${total === 1 ? '' : 's'}`
  const starting = startingCount(members)
  return starting === total ? size : `${size} · ${String(starting)} starting`
}

/** The same, for a list row that knows a count but may not have the roster. */
export function rosterSummaryFor(memberCount: number, roster: readonly TeamMember[] | undefined): string {
  if (!roster || roster.length === 0) {
    return `${String(memberCount)} member${memberCount === 1 ? '' : 's'}`
  }
  return rosterSummary(roster)
}
