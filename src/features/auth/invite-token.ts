/**
 * The raw invitation token, carried into the app on the landing URL.
 *
 * The invite email lands on `<site>/?invite_token=<raw>`, and GoTrue appends
 * its own `#access_token=…` fragment. The token must be in the real query
 * string rather than inside the hash route: `parseParametersFromURL` in
 * auth-js reads everything after the *first* `#`, so a hash-router path in
 * front of the fragment swallows `access_token` and no session is ever
 * established.
 *
 * Threat model, stated honestly. A token in a query string is not secret in
 * transit. It appears in the initial HTTP request line, so by the time this
 * module runs it may already be recorded in a hosting provider's access log, a
 * corporate proxy, or the browser's own network panel. Nothing in this file
 * can undo that, and it should not be described as if it could. Rotating the
 * invitation is the remedy if a link is known to have leaked.
 *
 * What this module does control is everything after that first request:
 *
 *   - the value lives in a module variable, never `localStorage` or
 *     `sessionStorage`, so it dies with the tab and cannot be read back by
 *     later code or by another session;
 *   - the query parameter is stripped synchronously, before React renders, so
 *     it leaves the visible URL and the back/forward history, and is not sent
 *     in the `Referer` of any subresource the page subsequently loads;
 *   - it is handed out exactly once;
 *   - it is never logged, and never passed to anything but the
 *     `accept_invitation` RPC.
 *
 * The token is not a credential on its own. `accept_invitation` additionally
 * requires a signed-in user whose email matches the invitation, that the
 * invitation is still pending, and that it has not expired. A stolen link is
 * useless without the invited mailbox.
 */

const PARAM = 'invite_token'

/**
 * The Edge Function generates 32 CSPRNG bytes, base64url-encoded. Anything
 * that is not plausibly one of those is discarded rather than forwarded, so a
 * hand-edited URL fails here instead of turning into a pointless RPC call.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,200}$/

let pending: string | null = null

/**
 * Remove the parameter from the address bar without disturbing the fragment.
 *
 * The fragment still holds the tokens Supabase has not read yet, so it must
 * survive untouched; `replaceState` (rather than assigning to `location`)
 * leaves no extra history entry to go back to.
 */
function stripParamFromUrl(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(PARAM)) return
    url.searchParams.delete(PARAM)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    // A browser that refuses replaceState is not a reason to fail the invite.
  }
}

/**
 * Read the token out of the URL and remove it. Call once, synchronously, as
 * early as possible — before the router reads `window.location`.
 */
export function captureInviteTokenFromUrl(): void {
  if (typeof window === 'undefined') return

  let raw: string | null = null
  try {
    raw = new URL(window.location.href).searchParams.get(PARAM)
  } catch {
    return
  }

  // Strip whether or not the value is usable: a malformed token should not be
  // left sitting in the address bar either.
  if (raw !== null) stripParamFromUrl()
  if (raw !== null && TOKEN_PATTERN.test(raw)) pending = raw
}

/**
 * Stash a token that arrived by a route other than the landing URL — today
 * that means a desktop deep link, which has no address bar to strip.
 *
 * Same validation, same memory-only storage.
 */
export function stashInviteToken(raw: string): void {
  if (TOKEN_PATTERN.test(raw)) pending = raw
}

/** Whether a token is waiting to be redeemed. Does not consume it. */
export function hasPendingInviteToken(): boolean {
  return pending !== null
}

/**
 * Hand over the token, exactly once.
 *
 * Single-use matters because the accept page can mount more than once while
 * Supabase settles the session; a second redemption attempt would surface a
 * spurious "already used" error.
 */
export function consumeInviteToken(): string | null {
  const token = pending
  pending = null
  return token
}

/** Test seam. Not referenced by application code. */
export function resetInviteTokenForTests(): void {
  pending = null
}
