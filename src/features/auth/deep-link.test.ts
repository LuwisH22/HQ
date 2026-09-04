import { describe, expect, it } from 'vitest'
import { parseAuthDeepLink } from './deep-link'

/**
 * A registered URL scheme can be invoked by any process on the machine, so
 * every one of these inputs is something a hostile caller could actually send.
 * The parser is an allow-list; these tests exist to keep it one.
 */

const TOKEN = 'zK3xQ9vB7nR2mL5tW8yF1cH4jD6sA0pE-_gU'

describe('parseAuthDeepLink — rejection', () => {
  it.each([
    ['a different scheme', 'https://auth/callback'],
    ['a web URL wearing the right path', 'https://evil.example.com/auth/callback'],
    ['a foreign host', 'lfghq://evil/callback'],
    ['an empty host', 'lfghq:///callback'],
    ['an unlisted path', 'lfghq://auth/admin'],
    ['no path at all', 'lfghq://auth'],
    ['a traversal attempt', 'lfghq://auth/callback/../../evil'],
    ['a nested path under an allowed prefix', 'lfghq://auth/callback/extra'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,<script>alert(1)</script>'],
    ['a file URL', 'file:///etc/passwd'],
    ['nonsense', 'not a url at all'],
    ['an empty string', ''],
  ])('rejects %s', (_label, raw) => {
    expect(parseAuthDeepLink(raw)).toBeNull()
  })

  it('rejects a scheme that merely starts with the right letters', () => {
    expect(parseAuthDeepLink('lfghqx://auth/callback')).toBeNull()
  })
})

describe('parseAuthDeepLink — acceptance', () => {
  it('maps each allowed path to a fixed internal route', () => {
    expect(parseAuthDeepLink('lfghq://auth/callback')?.route).toBe('/auth/callback')
    expect(parseAuthDeepLink('lfghq://auth/reset-password')?.route).toBe('/auth/reset-password')
    expect(parseAuthDeepLink('lfghq://auth/accept-invite')?.route).toBe('/auth/accept-invite')
  })

  it('extracts a PKCE code from the query string', () => {
    const parsed = parseAuthDeepLink('lfghq://auth/reset-password?code=abc123')
    expect(parsed?.code).toBe('abc123')
    expect(parsed?.accessToken).toBeNull()
  })

  it('extracts implicit-grant tokens from the fragment', () => {
    const parsed = parseAuthDeepLink(
      'lfghq://auth/callback#access_token=AAA&refresh_token=BBB&type=invite',
    )
    expect(parsed?.accessToken).toBe('AAA')
    expect(parsed?.refreshToken).toBe('BBB')
  })

  it('extracts an invitation token', () => {
    const parsed = parseAuthDeepLink(`lfghq://auth/accept-invite?invite_token=${TOKEN}`)
    expect(parsed?.inviteToken).toBe(TOKEN)
  })

  it('never returns a route derived from the URL text', () => {
    // Whatever an attacker puts in the path, the result is one of three
    // constants — the route is looked up, not carried through.
    const parsed = parseAuthDeepLink('lfghq://auth/callback?next=https://evil.example.com')
    expect(parsed?.route).toBe('/auth/callback')
  })
})
