import { describe, expect, it } from 'vitest'
import {
  ROSTER_STATUSES,
  ROSTER_STATUS_LABELS,
  compareForRoster,
  rosterSummary,
  rosterSummaryFor,
  startingCount,
} from './roster-status'
import type { TeamMember } from '@/services/team.service'

/**
 * Whether somebody is starting, and how a roster reads.
 *
 * The important assertion in this file is the one about words: a roster status
 * must never be phrased the way an account status is, because "inactive" next
 * to a person's name would be read as "suspended" by anybody who has seen the
 * members page.
 */

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  const id = overrides.memberId ?? 'membership-1'
  return {
    memberId: id,
    userId: `user-${id}`,
    position: null,
    status: 'active',
    addedAt: '2026-02-01T00:00:00.000Z',
    profile: {
      id: `user-${id}`,
      email: 'adit@lfg.gg',
      fullName: 'Adit',
      displayName: null,
      avatarUrl: null,
      title: null,
      timezone: 'Asia/Jakarta',
      lastSeenAt: null,
    },
    ...overrides,
  }
}

describe('the three statuses', () => {
  it('is starting, substitute, and not playing', () => {
    expect(ROSTER_STATUSES).toEqual(['active', 'substitute', 'inactive'])
  })

  it('never borrows the words an account status uses', () => {
    // organization_members.status is active / suspended / banned. A roster row
    // saying "Active" or "Suspended" beside a name would be read as the other
    // thing entirely.
    const words = Object.values(ROSTER_STATUS_LABELS).map((one) => one.toLowerCase())
    expect(words).not.toContain('active')
    expect(words).not.toContain('suspended')
    expect(words).not.toContain('banned')
    expect(words).not.toContain('inactive')
  })

  it('says something for every one of them', () => {
    for (const status of ROSTER_STATUSES) {
      expect(ROSTER_STATUS_LABELS[status].length).toBeGreaterThan(0)
    }
  })
})

describe('the order a roster reads in', () => {
  it('puts whoever is playing first', () => {
    const roster = [
      member({ memberId: 'c', status: 'inactive' }),
      member({ memberId: 'b', status: 'substitute' }),
      member({ memberId: 'a', status: 'active' }),
    ]
    expect([...roster].sort(compareForRoster).map((one) => one.memberId)).toEqual(['a', 'b', 'c'])
  })

  it('then by who joined first, which needs nothing stored', () => {
    const roster = [
      member({ memberId: 'later', addedAt: '2026-03-01T00:00:00.000Z' }),
      member({ memberId: 'earlier', addedAt: '2026-01-01T00:00:00.000Z' }),
    ]
    expect([...roster].sort(compareForRoster).map((one) => one.memberId)).toEqual([
      'earlier',
      'later',
    ])
  })

  it('is stable enough to sort twice and get the same answer', () => {
    const roster = [
      member({ memberId: 'a', status: 'substitute' }),
      member({ memberId: 'b', status: 'active' }),
      member({ memberId: 'c', status: 'active', addedAt: '2026-05-01T00:00:00.000Z' }),
    ]
    const once = [...roster].sort(compareForRoster).map((one) => one.memberId)
    const twice = [...roster].sort(compareForRoster).sort(compareForRoster).map((one) => one.memberId)
    expect(twice).toEqual(once)
  })
})

describe('counting', () => {
  it('counts only the people actually playing', () => {
    const roster = [
      member({ memberId: 'a' }),
      member({ memberId: 'b', status: 'substitute' }),
      member({ memberId: 'c', status: 'inactive' }),
    ]
    expect(startingCount(roster)).toBe(1)
  })

  it('says only the size when everybody is starting', () => {
    // "3 members · 3 starting" says the same thing twice.
    expect(rosterSummary([member({ memberId: 'a' }), member({ memberId: 'b' })])).toBe('2 members')
  })

  it('says how many are starting when they are not all the same', () => {
    const roster = [member({ memberId: 'a' }), member({ memberId: 'b', status: 'substitute' })]
    expect(rosterSummary(roster)).toBe('2 members · 1 starting')
  })

  it('counts one member without an s', () => {
    expect(rosterSummary([member()])).toBe('1 member')
  })

  it('says nothing about nobody', () => {
    expect(rosterSummary([])).toBe('0 members')
  })
})

describe('a list row that may not have the roster yet', () => {
  it('falls back to the count the team itself carries', () => {
    expect(rosterSummaryFor(5, undefined)).toBe('5 members')
  })

  it('uses the roster once it has one', () => {
    const roster = [member({ memberId: 'a' }), member({ memberId: 'b', status: 'inactive' })]
    expect(rosterSummaryFor(2, roster)).toBe('2 members · 1 starting')
  })

  it('does not claim a roster it was handed empty', () => {
    // An empty array here means "not loaded for this team", not "nobody on it":
    // the batched read only returns rows that exist.
    expect(rosterSummaryFor(4, [])).toBe('4 members')
  })
})
