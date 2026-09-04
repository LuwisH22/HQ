import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { resetInviteTokenForTests, stashInviteToken } from './invite-token'
import type { AuthStatus } from './auth-context'

/**
 * The invite page redeems first and sets a password second, which creates one
 * state worth guarding carefully: membership granted, password not saved. That
 * is not an invitation failure, and the user must never be told to go get
 * another invite — they are already in.
 */

const acceptInvitation = vi.fn<(token: string) => Promise<string>>()
const updatePassword = vi.fn<(password: string) => Promise<void>>()
const navigate = vi.fn()

let authStatus: AuthStatus = 'authenticated'

vi.mock('@/services/auth.service', () => ({
  authService: {
    acceptInvitation: (token: string) => acceptInvitation(token),
    updatePassword: (password: string) => updatePassword(password),
  },
}))

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    status: authStatus,
    user: { id: 'user-1', email: 'newcomer@lfg.test' },
    signOut: vi.fn(),
  }),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useNavigate: () => navigate }
})

const TOKEN = 'zK3xQ9vB7nR2mL5tW8yF1cH4jD6sA0pE-_gU'

async function renderPage() {
  const { AcceptInvitePage } = await import('./AcceptInvitePage')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AcceptInvitePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetInviteTokenForTests()
  authStatus = 'authenticated'
  acceptInvitation.mockResolvedValue('org-1')
  updatePassword.mockResolvedValue(undefined)
})

describe('invitation acceptance', () => {
  it('redeems the captured token and moves on to the password step', async () => {
    stashInviteToken(TOKEN)
    await renderPage()

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith(TOKEN)
    })
    expect(await screen.findByText('Choose a password')).toBeInTheDocument()
  })

  it('redeems only once even if the component re-renders', async () => {
    stashInviteToken(TOKEN)
    const { rerender } = await renderPage()
    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledTimes(1)
    })

    rerender(<div />)
    expect(acceptInvitation).toHaveBeenCalledTimes(1)
  })

  it('reports a failed redemption as an invitation problem', async () => {
    stashInviteToken(TOKEN)
    acceptInvitation.mockRejectedValue(new Error('This invitation has already been used'))
    await renderPage()

    expect(await screen.findByText('We could not accept this invitation')).toBeInTheDocument()
  })

  it('explains itself when no token reached the page', async () => {
    await renderPage()

    expect(await screen.findByText('We could not accept this invitation')).toBeInTheDocument()
    expect(acceptInvitation).not.toHaveBeenCalled()
  })

  it('does not redeem before the session resolves', async () => {
    authStatus = 'loading'
    stashInviteToken(TOKEN)
    await renderPage()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(acceptInvitation).not.toHaveBeenCalled()
    expect(screen.getByText('Verifying your invitation…')).toBeInTheDocument()
  })
})

describe('password establishment', () => {
  it('sets the password and confirms membership', async () => {
    const user = userEvent.setup()
    stashInviteToken(TOKEN)
    await renderPage()

    await screen.findByText('Choose a password')
    await user.type(screen.getByLabelText(/^Password/), 'a-long-enough-password')
    await user.type(screen.getByLabelText(/Confirm password/), 'a-long-enough-password')
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }))

    await waitFor(() => {
      expect(updatePassword).toHaveBeenCalledWith('a-long-enough-password')
    })
    expect(await screen.findByText("You're in")).toBeInTheDocument()
  })

  it('does not submit a password that fails validation', async () => {
    const user = userEvent.setup()
    stashInviteToken(TOKEN)
    await renderPage()

    await screen.findByText('Choose a password')
    await user.type(screen.getByLabelText(/^Password/), 'short')
    await user.type(screen.getByLabelText(/Confirm password/), 'short')
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }))

    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument()
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('keeps the membership when only the password step fails', async () => {
    const user = userEvent.setup()
    stashInviteToken(TOKEN)
    updatePassword.mockRejectedValue(new Error('Password is too weak'))
    await renderPage()

    await screen.findByText('Choose a password')
    await user.type(screen.getByLabelText(/^Password/), 'a-long-enough-password')
    await user.type(screen.getByLabelText(/Confirm password/), 'a-long-enough-password')
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }))

    // The invitation succeeded. Saying otherwise would send a member who is
    // already in the organization back to ask for another invite.
    expect(await screen.findByText("You're in — but the password did not save")).toBeInTheDocument()
    expect(screen.queryByText('We could not accept this invitation')).not.toBeInTheDocument()
    expect(acceptInvitation).toHaveBeenCalledTimes(1)
  })

  it('offers retry and recovery after a password failure, without a new token', async () => {
    const user = userEvent.setup()
    stashInviteToken(TOKEN)
    updatePassword.mockRejectedValue(new Error('Network error'))
    await renderPage()

    await screen.findByText('Choose a password')
    await user.type(screen.getByLabelText(/^Password/), 'a-long-enough-password')
    await user.type(screen.getByLabelText(/Confirm password/), 'a-long-enough-password')
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }))

    await screen.findByText("You're in — but the password did not save")
    expect(screen.getByRole('button', { name: 'Email me a password link instead' })).toBeVisible()

    // Retrying must not need the invitation token again — it is long gone.
    updatePassword.mockResolvedValue(undefined)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Choose a password')
    await user.type(screen.getByLabelText(/^Password/), 'another-good-password')
    await user.type(screen.getByLabelText(/Confirm password/), 'another-good-password')
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }))

    expect(await screen.findByText("You're in")).toBeInTheDocument()
    expect(acceptInvitation).toHaveBeenCalledTimes(1)
  })
})
