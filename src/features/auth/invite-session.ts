/**
 * The session handed over by an invite link.
 *
 * `inviteUserByEmail` is called server-side with the service-role key. There
 * is no browser in that flow and therefore no PKCE code verifier, so GoTrue
 * can only answer with an *implicit* grant: the tokens arrive in the URL
 * fragment.
 *
 * The client is configured `flowType: 'pkce'`, and supabase-js treats that as
 * exclusive — on seeing an implicit callback it throws
 * `AuthPKCEGrantCodeExchangeError('Not a valid PKCE flow url.')` rather than
 * consuming the tokens. Correct for a client-initiated flow, fatal for an
 * invite.
 *
 * Rather than downgrade `flowType` — which would relax every other auth flow
 * in the app — the invite landing performs this one handoff itself. Nothing is
 * weakened by doing so: these tokens were minted by GoTrue only after it
 * verified the one-time invite link, they arrive over the same redirect
 * supabase-js would have read, and `setSession` validates them against the
 * server before anything is trusted. The narrow, explicit path is the safer
 * one.
 *
 * Like the invitation token, the tokens live in memory only and are stripped
 * from the URL before the app renders.
 */
import { getSupabase } from '@/lib/supabase'

interface ImplicitTokens {
  accessToken: string
  refreshToken: string
}

export type InviteSessionOutcome = 'none' | 'applied' | 'failed'

let pending: ImplicitTokens | null = null

/**
 * Take the tokens out of the fragment and clear it.
 *
 * Clearing matters for more than tidiness: if the fragment were still present
 * when the Supabase client is first constructed, its initialisation would
 * throw the PKCE mismatch above.
 */
export function captureInviteSessionFromUrl(): void {
  if (typeof window === 'undefined') return

  const hash = window.location.hash
  if (!hash.startsWith('#') || !hash.includes('access_token=')) return

  let params: URLSearchParams
  try {
    params = new URLSearchParams(hash.slice(1))
  } catch {
    return
  }

  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) return

  pending = { accessToken, refreshToken }

  try {
    const url = new URL(window.location.href)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`)
  } catch {
    // Not fatal: the tokens are already captured.
  }
}

export function hasPendingInviteSession(): boolean {
  return pending !== null
}

/**
 * Exchange the captured tokens for a live session, exactly once.
 *
 * Returns `none` when the landing carried no tokens, so the caller can tell
 * "nothing to do" apart from "tried and failed".
 */
export async function applyPendingInviteSession(): Promise<InviteSessionOutcome> {
  const tokens = pending
  pending = null
  if (!tokens) return 'none'

  try {
    const { error } = await getSupabase().auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    })
    return error ? 'failed' : 'applied'
  } catch {
    return 'failed'
  }
}

/** Test seam. Not referenced by application code. */
export function resetInviteSessionForTests(): void {
  pending = null
}
