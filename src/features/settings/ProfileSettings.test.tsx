import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Profile } from '@/services/service-contracts'

/**
 * Regression coverage for async-loaded form values.
 *
 * The timezone control is rendered through a `Controller`, and an earlier
 * implementation seeded the form with `reset()` from an effect. Text inputs
 * populated but the select silently kept its placeholder — a bug that is
 * invisible until someone saves and their timezone is wiped.
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

vi.mock('@/services/profile.service', () => ({
  profileService: {
    getMine: () => getMine(),
    update: (patch: unknown) => update(patch),
    touchLastSeen: () => Promise.resolve(),
  },
}))

function renderProfileSettings(Component: React.ComponentType) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getMine.mockReset()
  update.mockReset()
  getMine.mockResolvedValue(profile)
})

describe('ProfileSettings', () => {
  it('populates the text inputs from the loaded profile', async () => {
    const { ProfileSettings } = await import('./ProfileSettings')
    renderProfileSettings(ProfileSettings)

    expect(await screen.findByDisplayValue('vance')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Riley Vance')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Founder & Owner')).toBeInTheDocument()
  })

  it('populates the timezone select from the loaded profile', async () => {
    const { ProfileSettings } = await import('./ProfileSettings')
    renderProfileSettings(ProfileSettings)

    // Radix renders the current selection as the combobox's accessible value.
    const combobox = await screen.findByRole('combobox', { name: /timezone/i })
    await waitFor(() => {
      expect(combobox).toHaveTextContent('Europe/Berlin')
    })
    expect(combobox).not.toHaveTextContent('Pick a timezone')
  })
})
