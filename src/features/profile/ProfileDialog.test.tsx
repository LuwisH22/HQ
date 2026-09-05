import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Profile } from '@/services/service-contracts'
import { useUiStore } from '@/stores/ui.store'

/**
 * Regression coverage for async-loaded form values.
 *
 * The timezone control is rendered through a `Controller`, and an earlier
 * implementation seeded the form with `reset()` from an effect. Text inputs
 * populated but the select silently kept its placeholder — a bug that is
 * invisible until someone saves and their timezone is wiped.
 *
 * The form moved out of Settings and into this dialog; the trap did not, so
 * neither did the test.
 */

const profile: Profile = {
  id: 'user-1',
  email: 'owner@lfg.test',
  fullName: 'Riley Vance',
  displayName: 'vance',
  avatarUrl: null,
  title: 'Founder & Owner',
  bio: 'Running the org.',
  timezone: 'Europe/Berlin',
  lastSeenAt: null,
}

const getMine = vi.fn<() => Promise<Profile | null>>()
const update = vi.fn()

// The dialog reads two pure helpers from this module as well as the service,
// so the mock supplies both rather than reaching for the real module.
vi.mock('@/services/profile.service', () => ({
  profileService: {
    getMine: () => getMine(),
    update: (patch: unknown) => update(patch),
    touchLastSeen: () => Promise.resolve(),
  },
  displayNameFor: (p: Profile) => p.displayName ?? p.fullName ?? p.email,
  initialsFor: () => 'RV',
}))

// The header shows the member's role; the form under test does not depend on
// it, so the workspace it comes from is stubbed rather than assembled.
vi.mock('@/hooks/use-workspace', () => ({
  useWorkspace: () => ({ membership: { role: { name: 'Owner' } } }),
}))

async function renderDialog() {
  const { ProfileDialog } = await import('./ProfileDialog')
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfileDialog />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getMine.mockReset()
  update.mockReset()
  getMine.mockResolvedValue(profile)
  // The dialog is driven by UI state, not by a prop.
  useUiStore.setState({ profileOpen: true })
})

describe('ProfileDialog', () => {
  it('populates the text inputs from the loaded profile', async () => {
    await renderDialog()

    expect(await screen.findByDisplayValue('vance')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Riley Vance')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Founder & Owner')).toBeInTheDocument()
  })

  it('populates the timezone select from the loaded profile', async () => {
    await renderDialog()

    // Radix renders the current selection as the combobox's accessible value.
    const combobox = await screen.findByRole('combobox', { name: /timezone/i })
    await waitFor(() => {
      expect(combobox).toHaveTextContent('Europe/Berlin')
    })
    expect(combobox).not.toHaveTextContent('Pick a timezone')
  })

  it('shows the sign-in address as text, never as a field to edit', async () => {
    await renderDialog()

    expect(await screen.findByText('owner@lfg.test')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('owner@lfg.test')).toBeNull()
  })

  it('stays shut when the store says so', async () => {
    useUiStore.setState({ profileOpen: false })
    await renderDialog()

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
