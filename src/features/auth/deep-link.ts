/**
 * Desktop deep links: `lfghq://auth/...`
 *
 * `auth.service.ts` already asks Supabase to send desktop users back through
 * this scheme, and the Rust side already registers it — but nothing has ever
 * listened, so password reset and magic link have been dead ends in the
 * installed app. This module is the missing half.
 *
 * Two rules govern everything here:
 *
 *   1. The incoming URL is untrusted input. Any process on the machine can
 *      invoke a registered scheme. So the parser is a closed allow-list: an
 *      exact scheme, an exact host, and one of three exact paths. Anything
 *      else is discarded.
 *
 *   2. A link never becomes a navigation target. `parseAuthDeepLink` returns
 *      one of three *hardcoded* internal routes; the URL's own path is only
 *      ever compared, never forwarded. That is what stops
 *      `lfghq://auth/callback/../../evil` or an absolute URL from steering the
 *      router.
 *
 * Session establishment bypasses the service seam and touches the Supabase
 * client directly. That is deliberate: the seam exists so features do not
 * depend on session shape, but this code *is* the thing that creates the
 * session the seam presupposes. Demo mode never receives deep links.
 */
import { getSupabase } from '@/lib/supabase'

/** The only internal destinations a deep link may reach. */
export type AuthDeepLinkRoute = '/auth/callback' | '/auth/reset-password' | '/auth/accept-invite'

const ALLOWED_PATHS: Record<string, AuthDeepLinkRoute> = {
  '/callback': '/auth/callback',
  '/reset-password': '/auth/reset-password',
  '/accept-invite': '/auth/accept-invite',
}

const SCHEME = 'lfghq:'
const HOST = 'auth'

export interface ParsedAuthDeepLink {
  /** A fixed internal route. Never derived from the URL's own text. */
  route: AuthDeepLinkRoute
  /** PKCE authorization code, for client-initiated flows. */
  code: string | null
  /** Implicit-grant tokens, for links the server originated. */
  accessToken: string | null
  refreshToken: string | null
  /** Raw invitation token, when the link carries one. */
  inviteToken: string | null
}

/** Parameters may arrive in the query or the fragment depending on the flow. */
function readParam(url: URL, name: string): string | null {
  const fromQuery = url.searchParams.get(name)
  if (fromQuery) return fromQuery
  if (!url.hash.startsWith('#')) return null
  try {
    return new URLSearchParams(url.hash.slice(1)).get(name)
  } catch {
    return null
  }
}

/**
 * Validate and destructure a deep link. Returns null for anything that is not
 * an LFG HQ auth link — the caller must treat null as "ignore entirely".
 */
export function parseAuthDeepLink(raw: string): ParsedAuthDeepLink | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== SCHEME) return null
  if (url.hostname !== HOST) return null

  // `URL` has already resolved any `..` segments, so this comparison cannot be
  // walked past with traversal.
  const route = ALLOWED_PATHS[url.pathname]
  if (!route) return null

  return {
    route,
    code: readParam(url, 'code'),
    accessToken: readParam(url, 'access_token'),
    refreshToken: readParam(url, 'refresh_token'),
    inviteToken: readParam(url, 'invite_token'),
  }
}

/**
 * Turn a parsed link into a session, if it carries the material for one.
 *
 * Returns the route to navigate to, or null when the link was not usable. The
 * desktop client sets `detectSessionInUrl: false` — there is no page load to
 * hang that off — so the exchange is explicit here.
 */
export async function establishSessionFromDeepLink(
  parsed: ParsedAuthDeepLink,
): Promise<AuthDeepLinkRoute> {
  const supabase = getSupabase()

  if (parsed.code) {
    // PKCE: the verifier was stored when this app started the flow, so an
    // exchange only succeeds for a link this installation actually requested.
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code)
    if (error) throw error
  } else if (parsed.accessToken && parsed.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    })
    if (error) throw error
  }

  return parsed.route
}
