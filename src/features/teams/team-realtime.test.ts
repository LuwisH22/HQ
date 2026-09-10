import { describe, expect, it } from 'vitest'
import { routeTeamChange, routeTeamsListChange, type Change } from './team-realtime'

/**
 * Where a change lands.
 *
 * Everyone in an organization who may view teams may view all of them, so a
 * topic hears about teams that are not on screen — and getting this wrong is
 * quiet either way. Too broad and every roster change anywhere redraws this
 * team; too narrow and the screen goes stale without saying so.
 */

const ORG = '3eddb674-7045-42aa-b9c5-7df5b9742486'
const OTHER_ORG = '00000000-0000-4000-8000-000000000000'
const TEAM = '11111111-1111-4111-8111-111111111111'
const OTHER_TEAM = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'

const scope = { organizationId: ORG, teamId: TEAM }
const route = (change: Change) => routeTeamChange(change, scope)

/** An insert or update: the row, as the subscriber is allowed to see it. */
const wrote = (table: string, row: Record<string, unknown>): Change => ({
  table,
  new: row,
  old: {},
})
/** A delete: the primary key, which is all replica identity default publishes. */
const deleted = (table: string, key: Record<string, unknown>): Change => ({
  table,
  new: {},
  old: key,
})
/** What a subscriber who may not read the row receives: an empty envelope. */
const unauthorized = (table: string): Change => ({ table, new: {}, old: {} })

const list = ['teams', ORG, 'list']
const detail = ['teams', ORG, 'detail', TEAM]
const members = ['teams', ORG, 'detail', TEAM, 'members']
const rosters = ['teams', ORG, 'rosters']

describe('a team itself', () => {
  it('refreshes this team and the list when this team changes', () => {
    // A rename, an archive and a restore are all this shape.
    expect(route(wrote('teams', { id: TEAM, organization_id: ORG }))).toEqual({
      keys: [list, detail],
    })
  })

  it('refreshes only the list when a different team changes', () => {
    expect(route(wrote('teams', { id: OTHER_TEAM, organization_id: ORG }))).toEqual({
      keys: [list],
    })
  })

  it('ignores another organization entirely', () => {
    expect(route(wrote('teams', { id: OTHER_TEAM, organization_id: OTHER_ORG }))).toEqual({
      keys: [],
    })
  })

  it('knows which team was deleted, because the key it carries is that id', () => {
    expect(route(deleted('teams', { id: TEAM }))).toEqual({ keys: [list, detail] })
    expect(route(deleted('teams', { id: OTHER_TEAM }))).toEqual({ keys: [list] })
  })
})

describe('a roster', () => {
  it('refreshes the roster, the team and what the list draws from it', () => {
    expect(route(wrote('team_members', { team_id: TEAM, member_id: MEMBER }))).toEqual({
      keys: [members, detail, rosters, list],
    })
  })

  it('treats a position or status change the same way', () => {
    expect(
      route(
        wrote('team_members', {
          team_id: TEAM,
          member_id: MEMBER,
          roster_position: 'Duelist',
          roster_status: 'substitute',
        }),
      ),
    ).toEqual({ keys: [members, detail, rosters, list] })
  })

  it('places a removal precisely, because the key is the pair', () => {
    // The primary key is (team_id, member_id), so a delete says which roster
    // changed without replica identity being widened to FULL.
    expect(route(deleted('team_members', { team_id: TEAM, member_id: MEMBER }))).toEqual({
      keys: [members, detail, rosters, list],
    })
  })

  it('ignores a roster change on another team', () => {
    expect(route(wrote('team_members', { team_id: OTHER_TEAM, member_id: MEMBER }))).toEqual({
      keys: [],
    })
    expect(route(deleted('team_members', { team_id: OTHER_TEAM, member_id: MEMBER }))).toEqual({
      keys: [],
    })
  })

  it('never carries a position or a status into a cache', () => {
    const refresh = route(
      wrote('team_members', { team_id: TEAM, member_id: MEMBER, roster_position: 'IGL' }),
    )

    // Only keys come out of here. What somebody does on a team is read back
    // through RLS, never trusted from the wire.
    expect(JSON.stringify(refresh)).not.toContain('IGL')
  })
})

describe('a move, which is two rows in two teams', () => {
  it('refreshes the team somebody left', () => {
    expect(route(deleted('team_members', { team_id: TEAM, member_id: MEMBER }))).toEqual({
      keys: [members, detail, rosters, list],
    })
  })

  it('refreshes the team they arrived on, from its own topic', () => {
    const arriving = routeTeamChange(wrote('team_members', { team_id: OTHER_TEAM, member_id: MEMBER }), {
      organizationId: ORG,
      teamId: OTHER_TEAM,
    })
    expect(arriving.keys).toContainEqual(['teams', ORG, 'detail', OTHER_TEAM, 'members'])
  })

  it('needs no special case: each half is an ordinary event', () => {
    // Nothing reconstructs a movement from one payload, and nothing merges the
    // two. Each team's own refetch settles where somebody ended up.
    const off = route(deleted('team_members', { team_id: TEAM, member_id: MEMBER }))
    const on = route(wrote('team_members', { team_id: TEAM, member_id: MEMBER }))
    expect(off).toEqual(on)
  })
})

describe('what cannot be attributed', () => {
  it('treats an unauthorized envelope as news about this team', () => {
    expect(route(unauthorized('teams'))).toEqual({ keys: [list, detail] })
    expect(route(unauthorized('team_members'))).toEqual({
      keys: [members, detail, rosters, list],
    })
  })

  it('ignores a table nobody subscribed to', () => {
    expect(route(wrote('projects', { id: 'p1' }))).toEqual({ keys: [] })
  })
})

describe('the list on its own', () => {
  it('refreshes the list when a team in this organization changes', () => {
    expect(routeTeamsListChange(wrote('teams', { organization_id: ORG }), ORG)).toEqual({
      keys: [list],
    })
  })

  it('ignores another organization', () => {
    expect(routeTeamsListChange(wrote('teams', { organization_id: OTHER_ORG }), ORG)).toEqual({
      keys: [],
    })
  })

  it('refreshes the counts and the faces when any roster changes', () => {
    expect(routeTeamsListChange(wrote('team_members', { team_id: TEAM }), ORG)).toEqual({
      keys: [rosters, list],
    })
  })

  it('never asks for one team’s roster family, which it does not hold', () => {
    const refresh = routeTeamsListChange(wrote('team_members', { team_id: TEAM }), ORG)
    expect(JSON.stringify(refresh.keys)).not.toContain('members')
  })

  it('hears nothing about anything else', () => {
    expect(routeTeamsListChange(wrote('tasks', { project_id: 'p1' }), ORG)).toEqual({ keys: [] })
  })
})
