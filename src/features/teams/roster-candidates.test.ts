import { describe, expect, it } from 'vitest'
import { handleOf, rosterCandidates } from './roster-candidates'
import type { OrganizationMember } from '@/services/organization.service'
import type { TeamMember } from '@/services/team.service'

/**
 * Who may be offered a place on a roster.
 *
 * Every exclusion here is one `add_team_member` would make anyway, so the list
 * is what the routine would accept rather than a guess at it. Offering an
 * action that is going to fail is a worse interface than not offering it.
 */

const ROLE = { id: 'role-1', key: 'player', name: 'Player', rank: 10 }

function member(overrides: Partial<OrganizationMember> = {}): OrganizationMember {
  const id = overrides.id ?? 'membership-1'
  return {
    id,
    userId: `user-${id}`,
    organizationId: 'org-1',
    status: 'active',
    joinedAt: '2026-01-01T00:00:00.000Z',
    role: ROLE,
    roles: [ROLE],
    suspendedUntil: null,
    moderationReason: null,
    profile: {
      id: `user-${id}`,
      email: 'adit@example.com',
      fullName: 'Adit',
      displayName: null,
      avatarUrl: null,
      title: null,
      timezone: 'Asia/Jakarta',
      lastSeenAt: null,
    },
    ...overrides,
  } as OrganizationMember
}

function named(id: string, name: string, email: string): OrganizationMember {
  const base = member({ id })
  return { ...base, profile: { ...base.profile, fullName: name, email } }
}

function onRoster(memberId: string): TeamMember {
  return {
    memberId,
    userId: `user-${memberId}`,
    position: null,
    status: 'active',
    addedAt: '2026-02-01T00:00:00.000Z',
    profile: {
      id: `user-${memberId}`,
      email: 'someone@example.com',
      fullName: 'Someone',
      displayName: null,
      avatarUrl: null,
      title: null,
      timezone: 'UTC',
      lastSeenAt: null,
    },
  }
}

describe('who is offered', () => {
  it('offers an active member who is not on the team', () => {
    expect(rosterCandidates([member()], [])).toHaveLength(1)
  })

  it('does not offer somebody already on the roster', () => {
    expect(rosterCandidates([member({ id: 'm1' })], [onRoster('m1')])).toHaveLength(0)
  })

  it('does not offer a banned member', () => {
    expect(rosterCandidates([member({ status: 'banned' })], [])).toHaveLength(0)
  })

  it('does not offer a member whose suspension has not lapsed', () => {
    const until = new Date(Date.now() + 86_400_000).toISOString()
    const suspended = member({ status: 'suspended', suspendedUntil: until })
    expect(rosterCandidates([suspended], [])).toHaveLength(0)
  })

  it('offers a member whose suspension has lapsed', () => {
    // The same derivation the database reads access from: a lapsed suspension
    // restores eligibility with nothing written.
    const until = new Date(Date.now() - 86_400_000).toISOString()
    const lapsed = member({ status: 'suspended', suspendedUntil: until })
    expect(rosterCandidates([lapsed], [])).toHaveLength(1)
  })

  it('does not offer an indefinitely suspended member', () => {
    const forever = member({ status: 'suspended', suspendedUntil: null })
    expect(rosterCandidates([forever], [])).toHaveLength(0)
  })

  it('offers nobody out of nobody', () => {
    expect(rosterCandidates([], [])).toEqual([])
  })
})

describe('searching', () => {
  const people = [
    named('m1', 'Adit Pratama', 'adit@lfg.gg'),
    named('m2', 'Luwis', 'luwis@lfg.gg'),
    named('m3', 'AGER', 'ager@lfg.gg'),
  ]

  it('matches a name, whatever the case', () => {
    expect(rosterCandidates(people, [], 'adit').map((one) => one.id)).toEqual(['m1'])
    expect(rosterCandidates(people, [], 'ADIT').map((one) => one.id)).toEqual(['m1'])
  })

  it('matches the part of an address a person is known by', () => {
    expect(rosterCandidates(people, [], 'luwis').map((one) => one.id)).toEqual(['m2'])
  })

  it('does not match the domain everybody shares', () => {
    // Searching "lfg" must not return the whole organization just because
    // everybody's address ends the same way.
    expect(rosterCandidates(people, [], 'lfg')).toHaveLength(0)
  })

  it('returns everybody eligible when nothing is typed', () => {
    expect(rosterCandidates(people, [], '   ')).toHaveLength(3)
  })

  it('sorts by the name a person is shown under', () => {
    expect(rosterCandidates(people, []).map((one) => one.profile.fullName)).toEqual([
      'Adit Pratama',
      'AGER',
      'Luwis',
    ])
  })
})

describe('handles', () => {
  it('is the part before the at sign', () => {
    expect(handleOf('adit@lfg.gg')).toBe('adit')
  })

  it('copes with something that is not an address', () => {
    expect(handleOf('adit')).toBe('adit')
  })
})
