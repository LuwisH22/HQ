import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The invite email is the one flow in the app that arrives as an implicit
 * grant, and `flowType: 'pkce'` makes supabase-js refuse to consume it. These
 * tests pin the narrow handoff that covers the gap — including that the
 * fragment is gone before the Supabase client could ever see it and throw.
 */

const setSession = vi.fn()

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { setSession: (t: unknown) => setSession(t) } }),
}))

function setUrl(url: string): void {
  window.history.replaceState({}, '', url)
}

async function load() {
  return import('./invite-session')
}

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await load()
  mod.resetInviteSessionForTests()
  localStorage.clear()
  sessionStorage.clear()
  setSession.mockResolvedValue({ error: null })
  setUrl('/')
})

describe('captureInviteSessionFromUrl', () => {
  it('captures implicit-grant tokens from the fragment', async () => {
    const mod = await load()
    setUrl('/#access_token=AAA&refresh_token=BBB&expires_in=3600&type=invite')
    mod.captureInviteSessionFromUrl()

    expect(mod.hasPendingInviteSession()).toBe(true)
  })

  it('clears the fragment so the Supabase client never sees it', async () => {
    const mod = await load()
    setUrl('/#access_token=AAA&refresh_token=BBB&type=invite')
    mod.captureInviteSessionFromUrl()

    // Left in place, this fragment makes supabase-js throw
    // "Not a valid PKCE flow url." during initialisation.
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain('AAA')
  })

  it('preserves an unrelated query string while clearing the fragment', async () => {
    const mod = await load()
    setUrl('/?keep=1#access_token=AAA&refresh_token=BBB')
    mod.captureInviteSessionFromUrl()

    expect(window.location.search).toBe('?keep=1')
    expect(window.location.hash).toBe('')
  })

  it('leaves an ordinary hash route alone', async () => {
    const mod = await load()
    setUrl('/#/members')
    mod.captureInviteSessionFromUrl()

    expect(mod.hasPendingInviteSession()).toBe(false)
    expect(window.location.hash).toBe('#/members')
  })

  it('ignores a fragment missing the refresh token', async () => {
    const mod = await load()
    setUrl('/#access_token=AAA&type=invite')
    mod.captureInviteSessionFromUrl()

    expect(mod.hasPendingInviteSession()).toBe(false)
  })

  it('never persists the tokens', async () => {
    const mod = await load()
    setUrl('/#access_token=AAA&refresh_token=BBB')
    mod.captureInviteSessionFromUrl()

    expect(JSON.stringify(localStorage)).not.toContain('AAA')
    expect(JSON.stringify(sessionStorage)).not.toContain('AAA')
  })
})

describe('applyPendingInviteSession', () => {
  it('establishes the session and reports applied', async () => {
    const mod = await load()
    setUrl('/#access_token=AAA&refresh_token=BBB')
    mod.captureInviteSessionFromUrl()

    await expect(mod.applyPendingInviteSession()).resolves.toBe('applied')
    expect(setSession).toHaveBeenCalledWith({ access_token: 'AAA', refresh_token: 'BBB' })
  })

  it('reports none when the landing carried no tokens', async () => {
    const mod = await load()
    await expect(mod.applyPendingInviteSession()).resolves.toBe('none')
    expect(setSession).not.toHaveBeenCalled()
  })

  it('reports failed when Supabase rejects the tokens', async () => {
    const mod = await load()
    setSession.mockResolvedValue({ error: new Error('invalid token') })
    setUrl('/#access_token=AAA&refresh_token=BBB')
    mod.captureInviteSessionFromUrl()

    await expect(mod.applyPendingInviteSession()).resolves.toBe('failed')
  })

  it('reports failed when the call throws outright', async () => {
    const mod = await load()
    setSession.mockRejectedValue(new Error('network down'))
    setUrl('/#access_token=AAA&refresh_token=BBB')
    mod.captureInviteSessionFromUrl()

    await expect(mod.applyPendingInviteSession()).resolves.toBe('failed')
  })

  it('applies at most once', async () => {
    const mod = await load()
    setUrl('/#access_token=AAA&refresh_token=BBB')
    mod.captureInviteSessionFromUrl()

    await mod.applyPendingInviteSession()
    await expect(mod.applyPendingInviteSession()).resolves.toBe('none')
    expect(setSession).toHaveBeenCalledTimes(1)
  })
})
