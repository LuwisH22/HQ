import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PermissionSet } from '@/lib/permissions'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/organization/workspace-context'
import type { Team, TeamMember } from '@/services/team.service'

/**
 * What each permission actually draws.
 *
 * The catalogue has said since day one that configuring a team and picking who
 * is on it are different jobs — `teams.manage` and `teams.roster_manage`, and
 * a coach holds the second without the first. The whole risk in this phase is
 * an interface that quietly merges them, so every combination is rendered and
 * asked what it offers.
 *
 * Four combinations, named the way the brief names them:
 *
 *   A  teams.view                                  read, and nothing else
 *   B  teams.view + teams.roster_manage            the roster, not the team
 *   C  teams.view + teams.manage                   the team, not the roster
 *   D  all three                                   everything
 *
 * Not a role name anywhere: the tests hold permission strings, which is what
 * the components hold too.
 */

const team = vi.hoisted(() => ({ current: null as Team | null }))
const roster = vi.hoisted(() => ({ current: [] as TeamMember[] }))
// The organization's other teams, which is what makes Move meaningful.
const others = vi.hoisted(() => ({ current: [] as Team[] }))

vi.mock('@/services/team.service', () => ({
  teamService: {
    get: () => Promise.resolve(team.current),
    listMembers: () => Promise.resolve(roster.current),
    list: () => Promise.resolve(others.current),
    listRosters: () => Promise.resolve({}),
    create: () => Promise.resolve('team-1'),
    update: () => Promise.resolve(),
    archive: () => Promise.resolve(),
    restore: () => Promise.resolve(),
    addMember: () => Promise.resolve(),
    removeMember: () => Promise.resolve(),
    updateMember: () => Promise.resolve(),
    moveMember: () => Promise.resolve(),
  },
}))

const { TeamDetailPage } = await import('./TeamDetailPage')

const ORGANIZATION = {
  id: 'org-1',
  slug: 'lfg',
  name: 'LFG',
  tagline: null,
  logoUrl: null,
  timezone: 'Asia/Jakarta',
}

function aTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    organizationId: 'org-1',
    name: 'Valorant Main',
    description: 'The starting five.',
    archivedAt: null,
    createdBy: 'user-1',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    memberCount: 1,
    ...overrides,
  }
}

const ADIT: TeamMember = {
  memberId: 'membership-1',
  userId: 'user-2',
  position: 'Duelist',
  status: 'active',
  addedAt: '2026-02-02T00:00:00.000Z',
  profile: {
    id: 'user-2',
    email: 'adit@lfg.gg',
    fullName: 'Adit',
    displayName: null,
    avatarUrl: null,
    title: null,
    timezone: 'Asia/Jakarta',
    lastSeenAt: null,
  },
}

async function show(permissions: string[]) {
  const value: WorkspaceContextValue = {
    status: 'ready',
    organization: ORGANIZATION,
    organizations: [ORGANIZATION],
    membership: null,
    permissions: new PermissionSet(permissions),
    error: null,
    selectOrganization: () => undefined,
    refresh: () => Promise.resolve(),
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={client}>
      <WorkspaceContext.Provider value={value}>
        <TooltipProvider>
          <MemoryRouter initialEntries={['/teams/team-1']}>
            <Routes>
              <Route path="/teams/:teamId" element={<TeamDetailPage />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  )

  // The name arriving is the page having loaded — but somebody without
  // teams.view never gets a name, they get refused.
  if (team.current && permissions.includes('teams.view')) {
    await screen.findByRole('heading', { level: 1, name: team.current.name })
  }
}

const button = (name: RegExp | string) => screen.queryByRole('button', { name })

beforeEach(() => {
  team.current = aTeam()
  roster.current = [ADIT]
  others.current = [aTeam(), aTeam({ id: 'team-2', name: 'Valorant Academy' })]
})

describe('A · teams.view only', () => {
  it('shows the team and its roster', async () => {
    await show(['teams.view'])

    expect(screen.getByRole('heading', { level: 1, name: 'Valorant Main' })).toBeInTheDocument()
    expect(await screen.findByText('Adit')).toBeInTheDocument()
  })

  it('offers nothing to change', async () => {
    await show(['teams.view'])
    await screen.findByText('Adit')

    expect(button('Edit')).toBeNull()
    expect(button('Archive')).toBeNull()
    expect(button('Add member')).toBeNull()
    expect(button(/^Remove Adit/)).toBeNull()
  })
})

describe('B · teams.view + teams.roster_manage', () => {
  it('offers the roster but not the team', async () => {
    // The coach case, and the reason the catalogue has two permissions.
    await show(['teams.view', 'teams.roster_manage'])
    await screen.findByText('Adit')

    expect(button('Add member')).toBeInTheDocument()
    expect(button(/^Remove Adit from Valorant Main$/)).toBeInTheDocument()

    expect(button('Edit')).toBeNull()
    expect(button('Archive')).toBeNull()
  })

  it('offers no restore on an archived team either', async () => {
    team.current = aTeam({ archivedAt: '2026-03-01T00:00:00.000Z' })
    await show(['teams.view', 'teams.roster_manage'])

    expect(button('Restore team')).toBeNull()
  })
})

describe('C · teams.view + teams.manage', () => {
  it('offers the team but not the roster', async () => {
    await show(['teams.view', 'teams.manage'])
    await screen.findByText('Adit')

    expect(button('Edit')).toBeInTheDocument()
    expect(button('Archive')).toBeInTheDocument()

    expect(button('Add member')).toBeNull()
    expect(button(/^Remove Adit/)).toBeNull()
  })
})

describe('D · all three', () => {
  it('offers both halves', async () => {
    await show(['teams.view', 'teams.manage', 'teams.roster_manage'])
    await screen.findByText('Adit')

    expect(button('Edit')).toBeInTheDocument()
    expect(button('Archive')).toBeInTheDocument()
    expect(button('Add member')).toBeInTheDocument()
    expect(button(/^Remove Adit from Valorant Main$/)).toBeInTheDocument()
  })
})

describe('an archived team', () => {
  beforeEach(() => {
    team.current = aTeam({ archivedAt: '2026-03-01T00:00:00.000Z' })
  })

  it('says so in a word, not only by being dimmer', async () => {
    await show(['teams.view'])
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('keeps the roster visible', async () => {
    await show(['teams.view', 'teams.roster_manage'])
    expect(await screen.findByText('Adit')).toBeInTheDocument()
  })

  it('offers no roster changes, however the permission stands', async () => {
    // The routine refuses them, so nothing is drawn that would fail.
    await show(['teams.view', 'teams.manage', 'teams.roster_manage'])
    await screen.findByText('Adit')

    expect(button('Add member')).toBeNull()
    expect(button(/^Remove Adit/)).toBeNull()
  })

  it('offers restore instead of edit and archive', async () => {
    await show(['teams.view', 'teams.manage'])
    await screen.findByText('Adit')

    expect(button('Restore team')).toBeInTheDocument()
    expect(button('Edit')).toBeNull()
    expect(button('Archive')).toBeNull()
  })
})

describe('a team that is not there', () => {
  it('says the same thing whether it is missing or somebody else’s', async () => {
    // Never "it exists but is not yours": that would confirm a team in another
    // organization to somebody who cannot see it.
    team.current = null
    await show(['teams.view', 'teams.manage'])

    expect(await screen.findByText('Team unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/permission/i)).toBeNull()
    expect(button('Edit')).toBeNull()
  })
})

describe('somebody without teams.view', () => {
  it('is refused the page, not merely the navigation row', async () => {
    await show([])

    expect(await screen.findByText(/does not include access to teams/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Valorant Main' })).toBeNull()
  })
})

describe('the roster itself', () => {
  it('counts what is on it', async () => {
    await show(['teams.view'])
    expect(await screen.findByText('1 member')).toBeInTheDocument()
  })

  it('says so plainly when nobody is on it', async () => {
    roster.current = []
    await show(['teams.view'])
    expect(await screen.findByText('Nobody is on this team yet.')).toBeInTheDocument()
  })

  it('shows a person by name, handle, position and status', async () => {
    await show(['teams.view'])
    expect(await screen.findByText('Adit')).toBeInTheDocument()
    expect(screen.getByText('adit')).toBeInTheDocument()
    // What they do and whether they are playing, in words rather than colour.
    expect(screen.getByText('Duelist · Starting')).toBeInTheDocument()
  })

  it('invents nothing a roster does not hold', async () => {
    await show(['teams.view'])
    await screen.findByText('Adit')
    // No rank, no record, no online state: none of them are columns, and a
    // position is whatever the organization typed rather than a known list.
    expect(screen.queryByText(/online|rank|win|loss|record/i)).toBeNull()
  })

  it('says a status even when nobody has typed a position', async () => {
    roster.current = [{ ...ADIT, position: null }]
    await show(['teams.view'])
    expect(await screen.findByText('Starting')).toBeInTheDocument()
  })
})

/**
 * The 7.3 controls, against the same four combinations.
 *
 * Editing what somebody does on a team and moving them to another are roster
 * operations. They belong to `teams.roster_manage` and must never appear for
 * somebody who merely manages the team — that is the distinction the whole
 * permission split exists for, and it is the easiest thing in this phase to
 * get quietly wrong.
 */
describe('roster operations, by permission', () => {
  it('A · teams.view alone offers neither', async () => {
    await show(['teams.view'])
    await screen.findByText('Adit')

    expect(button(/^Edit Adit/)).toBeNull()
    expect(button(/^Move Adit/)).toBeNull()
  })

  it('B · teams.roster_manage offers both', async () => {
    await show(['teams.view', 'teams.roster_manage'])
    await screen.findByText('Adit')

    expect(button('Edit Adit’s roster details')).toBeInTheDocument()
    expect(button('Move Adit to another team')).toBeInTheDocument()
    // And still nothing that belongs to the team itself.
    expect(button('Edit')).toBeNull()
    expect(button('Archive')).toBeNull()
  })

  it('C · teams.manage offers neither', async () => {
    // Renaming a team is not permission to decide who plays.
    await show(['teams.view', 'teams.manage'])
    await screen.findByText('Adit')

    expect(button(/^Edit Adit/)).toBeNull()
    expect(button(/^Move Adit/)).toBeNull()
    expect(button('Edit')).toBeInTheDocument()
  })

  it('D · both permissions offer both halves', async () => {
    await show(['teams.view', 'teams.manage', 'teams.roster_manage'])
    await screen.findByText('Adit')

    expect(button('Edit Adit’s roster details')).toBeInTheDocument()
    expect(button('Move Adit to another team')).toBeInTheDocument()
    expect(button('Edit')).toBeInTheDocument()
    expect(button('Archive')).toBeInTheDocument()
  })

  it('offers no move when there is nowhere to move to', async () => {
    // One team in the organization: the control would open a dialog with an
    // empty list, so it is not drawn.
    others.current = [aTeam()]
    await show(['teams.view', 'teams.roster_manage'])
    await screen.findByText('Adit')

    expect(button(/^Move Adit/)).toBeNull()
    expect(button('Edit Adit’s roster details')).toBeInTheDocument()
  })

  it('offers neither on an archived team', async () => {
    // The routines refuse both, so nothing is drawn that would fail.
    team.current = aTeam({ archivedAt: '2026-03-01T00:00:00.000Z' })
    await show(['teams.view', 'teams.manage', 'teams.roster_manage'])
    await screen.findByText('Adit')

    expect(button(/^Edit Adit/)).toBeNull()
    expect(button(/^Move Adit/)).toBeNull()
    expect(button('Add member')).toBeNull()
  })
})

describe('what the roster says about a side', () => {
  it('counts how many are starting when they are not all the same', async () => {
    roster.current = [
      ADIT,
      { ...ADIT, memberId: 'membership-2', status: 'substitute', position: 'Coach' },
    ]
    await show(['teams.view'])

    expect(await screen.findByText('2 members · 1 starting')).toBeInTheDocument()
  })

  it('says only the size when everybody is playing', async () => {
    roster.current = [ADIT, { ...ADIT, memberId: 'membership-2' }]
    await show(['teams.view'])

    expect(await screen.findByText('2 members')).toBeInTheDocument()
  })

  it('reads whoever is playing first', async () => {
    roster.current = [
      { ...ADIT, memberId: 'membership-2', status: 'inactive', profile: { ...ADIT.profile, fullName: 'Benched' } },
      { ...ADIT, memberId: 'membership-3', status: 'active', profile: { ...ADIT.profile, fullName: 'Starter' } },
    ]
    await show(['teams.view'])
    await screen.findByText('Starter')

    const names = screen.getAllByText(/^(Starter|Benched)$/).map((node) => node.textContent)
    expect(names).toEqual(['Starter', 'Benched'])
  })
})
