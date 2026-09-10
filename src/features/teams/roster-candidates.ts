import type { OrganizationMember } from '@/services/organization.service'
import type { TeamMember } from '@/services/team.service'
import { effectiveMemberStatus } from '@/lib/moderation'
import { displayNameFor } from '@/services/profile.service'

/**
 * Who could be added to a roster.
 *
 * Three things disqualify somebody, and the database agrees with every one of
 * them — `add_team_member` refuses each in turn, so this list is what the
 * routine would accept rather than a guess at it:
 *
 *   · already on the roster, which the primary key would swallow silently
 *   · not effectively active, which is a ban, or a suspension that has not
 *     lapsed — the same derivation the rest of the application reads access
 *     from, so somebody reinstated becomes offerable again with nothing written
 *   · nobody at all, which cannot happen here because the only source is this
 *     organization's own roster
 *
 * There is no separate directory to search. The candidates are the
 * organization's members, which is the same list Members draws, so there is
 * nothing to keep in step and no way for somebody from another organization to
 * appear — RLS would not return them in the first place.
 */
export function rosterCandidates(
  members: readonly OrganizationMember[],
  roster: readonly TeamMember[],
  search = '',
): OrganizationMember[] {
  const already = new Set(roster.map((member) => member.memberId))
  const needle = search.trim().toLowerCase()

  return members
    .filter((member) => !already.has(member.id))
    .filter((member) => effectiveMemberStatus(member.status, member.suspendedUntil) === 'active')
    .filter((member) => {
      if (needle === '') return true
      // Name and the local part of an address: what a person would type, and
      // what the member list already shows them.
      const name = displayNameFor(member.profile).toLowerCase()
      const handle = member.profile.email.split('@')[0]?.toLowerCase() ?? ''
      return name.includes(needle) || handle.includes(needle)
    })
    .sort((a, b) => displayNameFor(a.profile).localeCompare(displayNameFor(b.profile)))
}

/** The part of an address a person is known by, without the domain. */
export function handleOf(email: string): string {
  return email.split('@')[0] ?? email
}
