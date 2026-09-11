import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionGlobalConfig } from 'motion/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PermissionSet } from '@/lib/permissions'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/organization/workspace-context'
import type { CalendarEvent } from '@/services/calendar.service'

/**
 * The calendar as a workspace.
 *
 * What matters is that the grid and the panel are one place: picking a day
 * repaints the panel, opening an event goes deeper into it, writing and
 * changing happen there with the month still beside them, and the two
 * confirmations are strips rather than dialogs. The motion library is told to
 * skip its animations so a transition is a render, not a wait.
 */

MotionGlobalConfig.skipAnimations = true

// jsdom has no ResizeObserver; the select in the form and the sheet both ask for one.
class QuietResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = QuietResizeObserver

function anEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    organizationId: 'org-1',
    title: 'Scrim vs Onyx',
    description: 'Best of three.',
    location: 'Server SG-1',
    // 19:00 in Jakarta on 5 March.
    startsAt: '2026-03-05T12:00:00.000Z',
    endsAt: '2026-03-05T14:00:00.000Z',
    allDay: false,
    timezone: 'Asia/Jakarta',
    eventType: 'scrim',
    createdBy: 'user-1',
    reminderMinutes: 15,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  }
}

const store = vi.hoisted(() => ({
  events: [] as CalendarEvent[],
  created: [] as unknown[],
  updated: [] as unknown[],
  removed: [] as string[],
}))

vi.mock('@/services/calendar.service', () => ({
  calendarService: {
    listRange: () => Promise.resolve([...store.events]),
    create: (input: unknown) => {
      store.created.push(input)
      const created = anEvent({
        id: 'ev-new',
        title: (input as { title: string }).title,
        startsAt: (input as { startsAt: string }).startsAt,
        endsAt: (input as { endsAt: string }).endsAt,
        eventType: (input as { eventType: CalendarEvent['eventType'] }).eventType,
        location: null,
        description: null,
        reminderMinutes: null,
      })
      store.events.push(created)
      return Promise.resolve('ev-new')
    },
    update: (eventId: string, input: { title?: string }) => {
      store.updated.push({ eventId, input })
      const row = store.events.find((event) => event.id === eventId)
      if (row && input.title) {
        row.title = input.title
        row.updatedAt = '2026-03-02T00:00:00.000Z'
      }
      return Promise.resolve()
    },
    remove: (eventId: string) => {
      store.removed.push(eventId)
      store.events = store.events.filter((event) => event.id !== eventId)
      return Promise.resolve()
    },
  },
}))

vi.mock('@/services/profile.service', () => ({
  profileService: { getMine: () => Promise.resolve({ timezone: 'Asia/Jakarta' }) },
  displayNameFor: (profile: { displayName: string | null }) => profile.displayName ?? 'Someone',
}))

vi.mock('@/services/organization.service', () => ({
  organizationService: { listMembers: () => Promise.resolve([]) },
}))

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'user-1' }, signOut: vi.fn() }),
}))

// The socket is somebody else's test; here the calendar is what is on screen.
vi.mock('./use-calendar-realtime', () => ({ useCalendarRealtime: () => undefined }))

const { CalendarPage } = await import('./CalendarPage')

const ORGANIZATION = {
  id: 'org-1',
  slug: 'lfg',
  name: 'LFG',
  tagline: null,
  logoUrl: null,
  timezone: 'Asia/Jakarta',
}

function show(permissions: string[], url = '/calendar?date=2026-03-05') {
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
          <MemoryRouter initialEntries={[url]}>
            <CalendarPage />
          </MemoryRouter>
        </TooltipProvider>
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  )
}

/** The panel: the one region on the page, named by its own heading. */
function panel() {
  const section = document.querySelector('section')
  if (!section) throw new Error('No panel on the page')
  return within(section)
}

function grid() {
  return within(screen.getByRole('grid'))
}

/** The page with its events loaded: the grid is there, and so is the panel. */
async function loaded() {
  await screen.findByRole('grid')
  await screen.findByRole('heading', { name: 'Thursday, 5 March 2026', level: 2 })
}

const ALL = ['calendar.view', 'calendar.create', 'calendar.manage']

beforeEach(() => {
  store.events = [
    anEvent(),
    anEvent({
      id: 'ev-2',
      title: 'Team review',
      eventType: 'meeting',
      startsAt: '2026-03-05T04:30:00.000Z',
      endsAt: '2026-03-05T05:30:00.000Z',
    }),
    anEvent({
      id: 'ev-3',
      title: 'Match vs Kraken',
      eventType: 'match',
      startsAt: '2026-03-11T12:00:00.000Z',
      endsAt: '2026-03-11T15:00:00.000Z',
    }),
  ]
  store.created = []
  store.updated = []
  store.removed = []

  // A desktop: the panel is a column, not a sheet.
  window.matchMedia = (query: string) => ({
    matches: query.includes('min-width: 768px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })
})

describe('the day', () => {
  it('describes the selected day in the panel, in the order it happens', async () => {
    show(['calendar.view'])

    expect(
      await screen.findByRole('heading', { name: 'Thursday, 5 March 2026', level: 2 }),
    ).toBeInTheDocument()
    const rows = await panel().findAllByRole('button', { name: /Scrim vs Onyx|Team review/ })
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Team review, Meeting, 11:30',
      'Scrim vs Onyx, Scrim, 19:00',
    ])
    expect(panel().getByText('2 events')).toBeInTheDocument()
  })

  it('offers nothing to write without the permission', async () => {
    show(['calendar.view'])
    await screen.findByRole('heading', { name: 'Thursday, 5 March 2026', level: 2 })
    expect(screen.queryByRole('button', { name: /New event/ })).not.toBeInTheDocument()
  })

  it('repaints the panel when another day is picked', async () => {
    const user = userEvent.setup()
    show(['calendar.view'])
    await loaded()

    await user.click(grid().getByRole('gridcell', { name: /Wednesday, 11 March 2026/ }))

    expect(
      screen.getByRole('heading', { name: 'Wednesday, 11 March 2026', level: 2 }),
    ).toBeInTheDocument()
    expect(panel().getByRole('button', { name: /Match vs Kraken/ })).toBeInTheDocument()
    expect(grid().getByRole('gridcell', { name: /Wednesday, 11 March/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('says so when a day is empty, without a mascot', async () => {
    const user = userEvent.setup()
    show(['calendar.view'])
    await loaded()

    await user.click(grid().getByRole('gridcell', { name: /Thursday, 12 March 2026/ }))
    expect(panel().getByText('Nothing scheduled.')).toBeInTheDocument()
  })
})

describe('an event', () => {
  it('opens in the panel, deeper, with the way back', async () => {
    const user = userEvent.setup()
    show(ALL)
    await user.click(await panel().findByRole('button', { name: /Scrim vs Onyx/ }))

    expect(screen.getByRole('heading', { name: 'Scrim vs Onyx', level: 2 })).toBeInTheDocument()
    expect(panel().getByRole('button', { name: /Back to schedule/ })).toBeInTheDocument()
    expect(panel().getByText('Server SG-1')).toBeInTheDocument()
    expect(panel().getByText('15 minutes before')).toBeInTheDocument()
    expect(panel().getByRole('button', { name: /Edit event/ })).toBeInTheDocument()
    // The row in the grid knows it is the one open.
    expect(grid().getByRole('button', { name: /Scrim vs Onyx/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('opens from the grid as well, selecting its day on the way', async () => {
    const user = userEvent.setup()
    show(['calendar.view'])
    await loaded()

    await user.click(grid().getByRole('button', { name: /Match vs Kraken/ }))
    expect(screen.getByRole('heading', { name: 'Match vs Kraken', level: 2 })).toBeInTheDocument()
    expect(grid().getByRole('gridcell', { name: /Wednesday, 11 March/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('hides Edit and Delete from a reader who may not change it', async () => {
    const user = userEvent.setup()
    show(['calendar.view'])
    await user.click(await panel().findByRole('button', { name: /Scrim vs Onyx/ }))

    expect(screen.getByRole('heading', { name: 'Scrim vs Onyx', level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit event/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete event/ })).not.toBeInTheDocument()
  })

  it('comes back to the schedule', async () => {
    const user = userEvent.setup()
    show(ALL)
    await user.click(await panel().findByRole('button', { name: /Scrim vs Onyx/ }))
    await user.click(panel().getByRole('button', { name: /Back to schedule/ }))

    expect(
      screen.getByRole('heading', { name: 'Thursday, 5 March 2026', level: 2 }),
    ).toBeInTheDocument()
  })

  it('confirms deletion in a strip, and deletes when told', async () => {
    const user = userEvent.setup()
    show(ALL)
    await user.click(await panel().findByRole('button', { name: /Scrim vs Onyx/ }))

    // The strip is closed: its buttons are not reachable.
    expect(panel().queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()

    await user.click(panel().getByRole('button', { name: 'Delete event' }))
    expect(panel().getByText('Delete this event?')).toBeInTheDocument()
    expect(panel().getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    // The event is still on screen behind the question.
    expect(screen.getByRole('heading', { name: 'Scrim vs Onyx', level: 2 })).toBeInTheDocument()

    const confirm = panel()
      .getAllByRole('button', { name: 'Delete event' })
      .find((button) => button.closest('[aria-hidden="false"]'))
    if (!confirm) throw new Error('No confirmation button')
    await user.click(confirm)

    await waitFor(() => expect(store.removed).toEqual(['ev-1']))
    expect(
      await screen.findByRole('heading', { name: 'Thursday, 5 March 2026', level: 2 }),
    ).toBeInTheDocument()
    expect(panel().queryByRole('button', { name: /Scrim vs Onyx/ })).not.toBeInTheDocument()
  })
})

describe('writing', () => {
  it('creates inside the panel and opens what it created', async () => {
    const user = userEvent.setup()
    show(ALL)
    await loaded()

    await user.click(panel().getByRole('button', { name: /New event/ }))
    expect(screen.getByRole('heading', { name: 'New event', level: 2 })).toBeInTheDocument()
    // The grid is still there, with the day still selected.
    expect(grid().getByRole('gridcell', { name: /Thursday, 5 March/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.type(screen.getByLabelText(/Title/), 'Team Strategy Review')
    await user.click(panel().getByRole('button', { name: 'Create event' }))

    await waitFor(() => expect(store.created).toHaveLength(1))
    expect(store.created[0]).toMatchObject({
      title: 'Team Strategy Review',
      organizationId: 'org-1',
    })
    expect(
      await screen.findByRole('heading', { name: 'Team Strategy Review', level: 2 }),
    ).toBeInTheDocument()
  })

  it('edits in the same panel, and guards unsaved typing behind a strip', async () => {
    const user = userEvent.setup()
    show(ALL)
    await user.click(await panel().findByRole('button', { name: /Scrim vs Onyx/ }))
    await user.click(panel().getByRole('button', { name: /Edit event/ }))

    expect(screen.getByRole('heading', { name: 'Edit event', level: 2 })).toBeInTheDocument()
    const save = panel().getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()

    await user.type(screen.getByLabelText(/Title/), ' and VOD')
    expect(save).toBeEnabled()

    // Leaving asks first, in place.
    await user.click(panel().getByRole('button', { name: 'Cancel' }))
    expect(panel().getByRole('button', { name: 'Keep editing' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Edit event', level: 2 })).toBeInTheDocument()

    await user.click(panel().getByRole('button', { name: 'Keep editing' }))
    expect(panel().queryByRole('button', { name: 'Keep editing' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Title/)).toHaveValue('Scrim vs Onyx and VOD')

    await user.click(panel().getByRole('button', { name: 'Cancel' }))
    await user.click(panel().getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('heading', { name: 'Scrim vs Onyx', level: 2 })).toBeInTheDocument()
  })

  it('saves an edit and shows the result', async () => {
    const user = userEvent.setup()
    show(ALL)
    await user.click(await panel().findByRole('button', { name: /Scrim vs Onyx/ }))
    await user.click(panel().getByRole('button', { name: /Edit event/ }))
    await user.type(screen.getByLabelText(/Title/), ' II')
    await user.click(panel().getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(store.updated).toHaveLength(1))
    expect(
      await screen.findByRole('heading', { name: 'Scrim vs Onyx II', level: 2 }),
    ).toBeInTheDocument()
  })
})

describe('the month', () => {
  it('turns, keeps a real day selected, and offers the way back to today', async () => {
    const user = userEvent.setup()
    show(['calendar.view'])
    await loaded()

    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { name: 'April 2026', level: 1 })).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'Sunday, 5 April 2026', level: 2 }),
    ).toBeInTheDocument()
  })

  it('arrives at an event from a link', async () => {
    show(['calendar.view'], '/calendar?date=2026-03-11&event=ev-3')
    expect(
      await screen.findByRole('heading', { name: 'Match vs Kraken', level: 2 }),
    ).toBeInTheDocument()
  })
})
