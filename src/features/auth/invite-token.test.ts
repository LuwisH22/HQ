import { beforeEach, describe, expect, it } from 'vitest'
import {
  captureInviteTokenFromUrl,
  consumeInviteToken,
  hasPendingInviteToken,
  resetInviteTokenForTests,
  stashInviteToken,
} from './invite-token'

/**
 * The invite landing is the one place a raw token touches the browser, so the
 * guarantees this module makes are worth pinning down: capture it, get it out
 * of the URL without disturbing Supabase's fragment, never persist it, and
 * hand it over exactly once.
 */

const TOKEN = 'zK3xQ9vB7nR2mL5tW8yF1cH4jD6sA0pE-_gU'

function setUrl(pathWithQuery: string): void {
  window.history.replaceState({}, '', pathWithQuery)
}

beforeEach(() => {
  resetInviteTokenForTests()
  localStorage.clear()
  sessionStorage.clear()
  setUrl('/')
})

describe('captureInviteTokenFromUrl', () => {
  it('captures the token from the real query string', () => {
    setUrl(`/?invite_token=${TOKEN}`)
    captureInviteTokenFromUrl()

    expect(hasPendingInviteToken()).toBe(true)
    expect(consumeInviteToken()).toBe(TOKEN)
  })

  it('strips the parameter from the visible URL', () => {
    setUrl(`/?invite_token=${TOKEN}`)
    captureInviteTokenFromUrl()

    expect(window.location.search).toBe('')
    expect(window.location.href).not.toContain(TOKEN)
    expect(window.location.href).not.toContain('invite_token')
  })

  it("leaves Supabase's fragment intact while stripping the query", () => {
    setUrl(`/?invite_token=${TOKEN}#access_token=abc&refresh_token=def`)
    captureInviteTokenFromUrl()

    // The fragment is the only place the session tokens exist at this point;
    // clobbering it would break sign-in for every invited user.
    expect(window.location.hash).toBe('#access_token=abc&refresh_token=def')
    expect(window.location.search).toBe('')
  })

  it('preserves unrelated query parameters', () => {
    setUrl(`/?utm_source=email&invite_token=${TOKEN}`)
    captureInviteTokenFromUrl()

    expect(window.location.search).toBe('?utm_source=email')
  })

  it('never writes the token to localStorage or sessionStorage', () => {
    setUrl(`/?invite_token=${TOKEN}`)
    captureInviteTokenFromUrl()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(JSON.stringify(localStorage)).not.toContain(TOKEN)
    expect(JSON.stringify(sessionStorage)).not.toContain(TOKEN)
  })

  it('is a no-op when no token is present', () => {
    setUrl('/?other=1')
    captureInviteTokenFromUrl()

    expect(hasPendingInviteToken()).toBe(false)
    expect(window.location.search).toBe('?other=1')
  })

  it('rejects a malformed token but still strips it from the URL', () => {
    setUrl('/?invite_token=short')
    captureInviteTokenFromUrl()

    expect(hasPendingInviteToken()).toBe(false)
    expect(window.location.search).toBe('')
  })

  it('rejects a token containing characters the generator never emits', () => {
    setUrl('/?invite_token=' + encodeURIComponent('../../etc/passwd&x=1'))
    captureInviteTokenFromUrl()

    expect(hasPendingInviteToken()).toBe(false)
  })
})

describe('consumeInviteToken', () => {
  it('hands the token over exactly once', () => {
    setUrl(`/?invite_token=${TOKEN}`)
    captureInviteTokenFromUrl()

    expect(consumeInviteToken()).toBe(TOKEN)
    // A second read must be empty: the accept page can mount twice while the
    // session settles, and redeeming twice reports a spurious "already used".
    expect(consumeInviteToken()).toBeNull()
    expect(hasPendingInviteToken()).toBe(false)
  })

  it('returns null when nothing was captured', () => {
    expect(consumeInviteToken()).toBeNull()
  })
})

describe('stashInviteToken', () => {
  it('accepts a well-formed token arriving from a deep link', () => {
    stashInviteToken(TOKEN)
    expect(consumeInviteToken()).toBe(TOKEN)
  })

  it('applies the same validation as the URL path', () => {
    stashInviteToken('nope')
    expect(hasPendingInviteToken()).toBe(false)
  })
})
