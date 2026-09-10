import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The team service, without a database.
 *
 * What is worth checking here is the shape of what goes over the wire and what
 * comes back out of it: that a roster write calls the routine rather than
 * touching the table, that `teams` is never asked for `*` when a count is
 * embedded, and that a roster row whose person cannot be read is dropped
 * rather than drawn as a blank.
 *
 * The rules themselves — permission, cross-organization integrity, archived
 * refusals, audit — live in the database, and `scripts/verify-teams.mjs`
 * checks them there, against the real one.
 */

interface Recorded {
  table?: string
  select?: string
  filters: [string, string, unknown][]
  rpc?: [string, Record<string, unknown>]
}

const recorded: Recorded = { filters: [] }
let rows: unknown[] = []
let single: unknown = null
let failure: { message: string; code?: string } | null = null

function builder() {
  const chain = {
    select(columns: string) {
      recorded.select = columns
      return chain
    },
    eq(column: string, value: unknown) {
      recorded.filters.push(['eq', column, value])
      return chain
    },
    maybeSingle() {
      return Promise.resolve({ data: single, error: failure })
    },
    order() {
      return Promise.resolve({ data: rows, error: failure })
    },
  }
  return chain
}

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from(table: string) {
      recorded.table = table
      return builder()
    },
    rpc(name: string, args: Record<string, unknown>) {
      recorded.rpc = [name, args]
      return Promise.resolve({ data: 'team-1', error: failure })
    },
  }),
}))

const demo = vi.hoisted(() => ({ active: false }))
vi.mock('@/lib/demo-mode', () => ({ isDemoSessionActive: () => demo.active }))

const { teamService } = await import('./team.service')

const TEAM = {
  id: 'team-1',
  organization_id: 'org-1',
  name: 'Valorant Main',
  description: 'The starting five.',
  archived_at: null,
  created_by: 'user-1',
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
  team_members: [{ count: 5 }],
}

const ROSTER_ROW = {
  member_id: 'membership-1',
  added_at: '2026-02-02T00:00:00.000Z',
  roster_position: null,
  roster_status: 'active',
  member: {
    user_id: 'user-2',
    profile: {
      id: 'user-2',
      email: 'adit@example.com',
      full_name: 'Adit',
      display_name: null,
      avatar_url: null,
      title: null,
      timezone: 'Asia/Jakarta',
      last_seen_at: null,
    },
  },
}

beforeEach(() => {
  recorded.table = undefined
  recorded.select = undefined
  recorded.filters = []
  recorded.rpc = undefined
  rows = []
  single = null
  failure = null
  demo.active = false
})

describe('reading teams', () => {
  it('asks for the columns it needs and a roster count, never for everything', async () => {
    rows = [TEAM]
    await teamService.list('org-1')

    expect(recorded.table).toBe('teams')
    expect(recorded.select).toContain('team_members(count)')
    expect(recorded.select).not.toContain('*')
    expect(recorded.filters).toContainEqual(['eq', 'organization_id', 'org-1'])
  })

  it('reads the count out of the embedded row', async () => {
    rows = [TEAM]
    const [team] = await teamService.list('org-1')

    expect(team?.memberCount).toBe(5)
    expect(team?.archivedAt).toBeNull()
    expect(team?.name).toBe('Valorant Main')
  })

  it('counts nobody when a team has no roster rows', async () => {
    rows = [{ ...TEAM, team_members: [] }]
    const [team] = await teamService.list('org-1')

    expect(team?.memberCount).toBe(0)
  })

  it('reports an archived team as archived', async () => {
    rows = [{ ...TEAM, archived_at: '2026-03-01T00:00:00.000Z' }]
    const [team] = await teamService.list('org-1')

    expect(team?.archivedAt).toBe('2026-03-01T00:00:00.000Z')
  })

  it('returns nothing rather than throwing when a team is not there', async () => {
    single = null
    expect(await teamService.get('team-1')).toBeNull()
  })
})

describe('reading a roster', () => {
  it('drops a row whose person cannot be read', async () => {
    // RLS can hide the profile behind a membership; half a person is nothing
    // to draw, so it is not drawn.
    rows = [ROSTER_ROW, { ...ROSTER_ROW, member_id: 'membership-2', member: null }]
    const roster = await teamService.listMembers('team-1')

    expect(roster).toHaveLength(1)
    expect(roster[0]?.memberId).toBe('membership-1')
    expect(roster[0]?.profile.email).toBe('adit@example.com')
  })

  it('keeps the membership id, which is what the routines take', async () => {
    rows = [ROSTER_ROW]
    const [member] = await teamService.listMembers('team-1')

    expect(member?.memberId).toBe('membership-1')
    expect(member?.userId).toBe('user-2')
  })
})

describe('writing', () => {
  it('creates through the routine, not the table', async () => {
    await teamService.create({ organizationId: 'org-1', name: 'Valorant Main' })

    expect(recorded.rpc?.[0]).toBe('create_team')
    expect(recorded.rpc?.[1]).toEqual({
      p_organization_id: 'org-1',
      p_name: 'Valorant Main',
      p_description: null,
    })
  })

  it('leaves out of an update whatever the caller left out', async () => {
    await teamService.update('team-1', { name: 'Valorant Academy' })

    expect(recorded.rpc?.[0]).toBe('update_team')
    expect(recorded.rpc?.[1]).toEqual({
      p_team_id: 'team-1',
      p_name: 'Valorant Academy',
      p_description: null,
    })
  })

  it('archives and restores through their own routines', async () => {
    await teamService.archive('team-1')
    expect(recorded.rpc?.[0]).toBe('archive_team')

    await teamService.restore('team-1')
    expect(recorded.rpc?.[0]).toBe('restore_team')
  })

  it('changes a roster through the roster routines', async () => {
    await teamService.addMember('team-1', 'membership-1')
    expect(recorded.rpc).toEqual([
      'add_team_member',
      { p_team_id: 'team-1', p_member_id: 'membership-1' },
    ])

    await teamService.removeMember('team-1', 'membership-1')
    expect(recorded.rpc?.[0]).toBe('remove_team_member')
  })

  it('sets a roster position and status through the roster routine', async () => {
    await teamService.updateMember('team-1', 'membership-1', {
      position: 'Duelist',
      status: 'substitute',
    })

    expect(recorded.rpc).toEqual([
      'update_team_member',
      {
        p_team_id: 'team-1',
        p_member_id: 'membership-1',
        p_position: 'Duelist',
        p_clear_position: false,
        p_status: 'substitute',
      },
    ])
  })

  it('says out loud when a position is being taken off', async () => {
    // Null on its own would be indistinguishable from "leave it alone", which
    // is why the routine has a flag rather than a convention.
    await teamService.updateMember('team-1', 'membership-1', { position: null })

    expect(recorded.rpc?.[1]).toMatchObject({ p_position: null, p_clear_position: true })
  })

  it('leaves a field alone when the caller did not mention it', async () => {
    await teamService.updateMember('team-1', 'membership-1', { status: 'inactive' })

    expect(recorded.rpc?.[1]).toMatchObject({ p_clear_position: false, p_position: null })
  })

  it('moves somebody in one call rather than two', async () => {
    // Two calls would leave them on both teams, or on neither, whenever the
    // second one failed.
    await teamService.moveMember('team-1', 'team-2', 'membership-1')

    expect(recorded.rpc).toEqual([
      'move_team_member',
      { p_from_team_id: 'team-1', p_to_team_id: 'team-2', p_member_id: 'membership-1' },
    ])
  })

  it('reads a position and a status off a roster row', async () => {
    rows = [{ ...ROSTER_ROW, roster_position: 'IGL', roster_status: 'substitute' }]
    const [member] = await teamService.listMembers('team-1')

    expect(member?.position).toBe('IGL')
    expect(member?.status).toBe('substitute')
  })

  it('has no way to delete a team at all', () => {
    // 7.1 archives. Teams are what rosters and results will hang off, and
    // there is no routine behind this to call even if something tried.
    expect('remove' in teamService).toBe(false)
  })
})

describe('demo mode', () => {
  it('reads nothing and refuses every write', async () => {
    demo.active = true

    expect(await teamService.list('org-1')).toEqual([])
    expect(await teamService.listMembers('team-1')).toEqual([])
    await expect(teamService.create({ organizationId: 'org-1', name: 'x' })).rejects.toThrow()
    await expect(teamService.addMember('team-1', 'membership-1')).rejects.toThrow()
    await expect(teamService.updateMember('team-1', 'membership-1', {})).rejects.toThrow()
    await expect(teamService.moveMember('team-1', 'team-2', 'membership-1')).rejects.toThrow()
  })
})
