import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { consumeInviteToken, resetInviteTokenForTests } from './invite-token'

/**
 * Cold start and warm start are separate code paths in the plugin, and getting
 * only one right produces a bug that looks intermittent — the link works when
 * the app happens to be open and does nothing otherwise. Both are covered
 * here, along with listener teardown and session establishment.
 */

const getCurrent = vi.fn<() => Promise<string[] | null>>()
const onOpenUrl = vi.fn<(cb: (urls: string[]) => void) => Promise<() => void>>()
const unlisten = vi.fn()

const navigate = vi.fn<(to: string, opts?: unknown) => Promise<void>>()
const exchangeCodeForSession = vi.fn()
const setSession = vi.fn()
const isDesktop = vi.fn<() => boolean>()

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: () => getCurrent(),
  onOpenUrl: (cb: (urls: string[]) => void) => onOpenUrl(cb),
}))

vi.mock('@/routes/router', () => ({
  router: { navigate: (to: string, opts?: unknown) => navigate(to, opts) },
}))

vi.mock('@/lib/platform', () => ({ isDesktop: () => isDesktop() }))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      exchangeCodeForSession: (code: string) => exchangeCodeForSession(code),
      setSession: (tokens: unknown) => setSession(tokens),
    },
  }),
}))

const TOKEN = 'zK3xQ9vB7nR2mL5tW8yF1cH4jD6sA0pE-_gU'

beforeEach(() => {
  vi.clearAllMocks()
  resetInviteTokenForTests()
  isDesktop.mockReturnValue(true)
  getCurrent.mockResolvedValue(null)
  onOpenUrl.mockResolvedValue(unlisten)
  navigate.mockResolvedValue(undefined)
  exchangeCodeForSession.mockResolvedValue({ error: null })
  setSession.mockResolvedValue({ error: null })
})

async function mount() {
  const { useAuthDeepLinks } = await import('./useAuthDeepLinks')
  return renderHook(() => {
    useAuthDeepLinks()
  })
}

describe('useAuthDeepLinks — cold start', () => {
  it('handles a link the app was launched with', async () => {
    getCurrent.mockResolvedValue(['lfghq://auth/reset-password?code=abc123'])
    await mount()

    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123')
    })
    expect(navigate).toHaveBeenCalledWith('/auth/reset-password', { replace: true })
  })

  it('does nothing when the app was launched normally', async () => {
    getCurrent.mockResolvedValue(null)
    await mount()

    await waitFor(() => {
      expect(onOpenUrl).toHaveBeenCalled()
    })
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('useAuthDeepLinks — warm start', () => {
  it('handles a link delivered while the app is running', async () => {
    await mount()
    await waitFor(() => {
      expect(onOpenUrl).toHaveBeenCalled()
    })

    const handler = onOpenUrl.mock.calls[0]?.[0]
    handler?.(['lfghq://auth/callback#access_token=AAA&refresh_token=BBB'])

    await waitFor(() => {
      expect(setSession).toHaveBeenCalledWith({ access_token: 'AAA', refresh_token: 'BBB' })
    })
    expect(navigate).toHaveBeenCalledWith('/auth/callback', { replace: true })
  })

  it('stashes an invitation token carried by the link', async () => {
    await mount()
    await waitFor(() => {
      expect(onOpenUrl).toHaveBeenCalled()
    })

    const handler = onOpenUrl.mock.calls[0]?.[0]
    handler?.([`lfghq://auth/accept-invite?invite_token=${TOKEN}`])

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/auth/accept-invite', { replace: true })
    })
    expect(consumeInviteToken()).toBe(TOKEN)
  })

  it('ignores a hostile link without navigating', async () => {
    await mount()
    await waitFor(() => {
      expect(onOpenUrl).toHaveBeenCalled()
    })

    const handler = onOpenUrl.mock.calls[0]?.[0]
    handler?.(['lfghq://evil/callback?code=abc'])

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(navigate).not.toHaveBeenCalled()
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('still routes to the destination when the exchange fails', async () => {
    // A stale link should land on the page that explains it is stale, rather
    // than leaving the user on whatever was on screen.
    exchangeCodeForSession.mockResolvedValue({ error: new Error('expired') })
    getCurrent.mockResolvedValue(['lfghq://auth/reset-password?code=old'])
    await mount()

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/auth/reset-password', { replace: true })
    })
  })
})

describe('useAuthDeepLinks — lifecycle', () => {
  it('removes the listener on unmount', async () => {
    const { unmount } = await mount()
    await waitFor(() => {
      expect(onOpenUrl).toHaveBeenCalled()
    })

    unmount()
    expect(unlisten).toHaveBeenCalled()
  })

  it('does nothing at all on web', async () => {
    isDesktop.mockReturnValue(false)
    await mount()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getCurrent).not.toHaveBeenCalled()
    expect(onOpenUrl).not.toHaveBeenCalled()
  })
})
