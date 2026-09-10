import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PermissionSet } from '@/lib/permissions'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/organization/workspace-context'
import type { Team, TeamMember } from '@/services/team.service'

/**
 * The list of teams.
 *
 * What matters here is what a person can tell at a glance — which teams exist,
 * who is on them, which have been put away — and that "New team" appears for
 * exactly one permission and no other.
 */

const ADIT: TeamMember = {
  memberId: 'membership-1',
  userId: 'user-2',
  position: null,
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

const teams = vi.hoisted(() => ({ current: [] as Team[], pending: false }))

vi.mock('@/services/team.service', () => ({
  teamService: {
    list: () =>
      teams.pending
        ? new Promise<Team[]>(() => {
            // Never resolves: the loading state, held open.
          })
        : Promise.resolve(teams.current),
    listRosters: () => Promise.resolve({ 'team-1': [ADIT] }),
    get: () => Promise.resolve(null),
    listMembers: () => Promise.resolve([]),
    create: () => Promise.resolve('team-1'),
    update: () => Promise.resolve(),
    archive: () => Promise.resolve(),
    restore: () => Promise.resolve(),
    addMember: () => Promise.resolve(),
    removeMember: () => Promise.resolve(),
  },
}))

const { TeamsPage } = await import('./TeamsPage')

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

function show(permissions: string[]) {
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

  return render(
    <QueryClientProvider client={client}>
      <WorkspaceContext.Provider value={value}>
        <TooltipProvider>
          <MemoryRouter>
            <TeamsPage />
          </MemoryRouter>
        </TooltipProvider>
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  teams.current = [aTeam()]
  teams.pending = false
})

describe('the list', () => {
  it('shows a team by name, with what it is for', async () => {
    show(['teams.view'])

    expect(await screen.findByText('Valorant Main')).toBeInTheDocument()
    expect(screen.getByText('The starting five.')).toBeInTheDocument()
    expect(screen.getByText('1 member')).toBeInTheDocument()
  })

  it('names the people on it for anybody not looking at the faces', async () => {
    show(['teams.view'])
    expect(await screen.findByText('Roster: Adit')).toBeInTheDocument()
  })

  it('groups what has been put away below what has not', async () => {
    teams.current = [
      aTeam(),
      aTeam({ id: 'team-2', name: 'Academy', archivedAt: '2026-03-01T00:00:00.000Z' }),
    ]
    show(['teams.view'])

    expect(await screen.findByRole('heading', { name: 'Active', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Archived', level: 2 })).toBeInTheDocument()
    // And says which is which in a word, not only by being dimmer.
    expect(screen.getByText('Archived', { selector: 'span' })).toBeInTheDocument()
  })

  it('draws no empty group', async () => {
    show(['teams.view'])
    await screen.findByText('Valorant Main')
    expect(screen.queryByRole('heading', { name: 'Archived', level: 2 })).toBeNull()
  })

  it('invents nothing a team does not have', async () => {
    show(['teams.view'])
    await screen.findByText('Valorant Main')
    expect(screen.queryByText(/rank|region|win|loss|record/i)).toBeNull()
  })
})

describe('while it is loading', () => {
  it('does not say there are no teams before it knows', async () => {
    teams.pending = true
    show(['teams.view'])

    expect(screen.queryByText('No teams yet')).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Teams', level: 1 })).toBeInTheDocument()
  })
})

describe('when there are none', () => {
  beforeEach(() => {
    teams.current = []
  })

  it('says so, and says what a team is, to somebody who can make one', async () => {
    show(['teams.view', 'teams.manage'])

    expect(await screen.findByText('No teams yet')).toBeInTheDocument()
    expect(screen.getByText(/a team is a group of people here/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New team' })).toBeInTheDocument()
  })

  it('says only that there are none, to somebody who cannot', async () => {
    show(['teams.view'])

    expect(await screen.findByText('No teams yet')).toBeInTheDocument()
    expect(screen.getByText('No teams have been created yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New team' })).toBeNull()
  })

  it('promises nothing that has not been built', async () => {
    show(['teams.view'])
    await screen.findByText('No teams yet')
    expect(screen.queryByText(/soon|phase|example|demo/i)).toBeNull()
  })
})

describe('who may start one', () => {
  it('offers it for teams.manage', async () => {
    show(['teams.view', 'teams.manage'])
    expect(await screen.findByRole('button', { name: 'New team' })).toBeInTheDocument()
  })

  it('does not offer it for teams.roster_manage', async () => {
    // Managing who is on a side is not permission to invent a new one.
    show(['teams.view', 'teams.roster_manage'])
    await screen.findByText('Valorant Main')
    expect(screen.queryByRole('button', { name: 'New team' })).toBeNull()
  })

  it('does not offer it for teams.view alone', async () => {
    show(['teams.view'])
    await screen.findByText('Valorant Main')
    expect(screen.queryByRole('button', { name: 'New team' })).toBeNull()
  })
})

describe('somebody without teams.view', () => {
  it('is refused the page rather than shown an empty one', () => {
    show([])

    expect(screen.getByText(/does not include access to teams/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Teams', level: 1 })).toBeNull()
  })
})
