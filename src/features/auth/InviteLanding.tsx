import { useEffect, useRef, useState } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import { router } from '@/routes/router'
import { useAuth } from '@/hooks/use-auth'
import { hasPendingInviteToken } from './invite-token'
import {
  applyPendingInviteSession,
  hasPendingInviteSession,
  type InviteSessionOutcome,
} from './invite-session'

/**
 * Holds the app on a neutral screen while an invite landing resolves.
 *
 * Three things have to happen in order, and none of them can be skipped:
 *
 *   1. the implicit-grant tokens from the invite email become a real session
 *      (`applyPendingInviteSession` — supabase-js will not do this itself
 *      while `flowType` is `pkce`);
 *   2. `AuthProvider` observes that session, so `status` settles;
 *   3. the router is pointed at the accept page.
 *
 * Releasing early is what makes this visibly wrong: the accept page would see
 * `unauthenticated` for a frame and tell someone mid-signup that their
 * invitation had expired. So the gate waits for `authenticated` specifically
 * when a session was applied, and merely for `status` to settle otherwise.
 *
 * With no invitation in flight this renders children immediately and costs a
 * single boolean.
 */
export function InviteLanding({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  // Read once. Both stores are consumed during this flow, so re-reading would
  // flip these to false mid-flight.
  const [pending] = useState(() => hasPendingInviteToken() || hasPendingInviteSession())
  const [outcome, setOutcome] = useState<InviteSessionOutcome | null>(null)
  const [released, setReleased] = useState(!pending)
  const navigated = useRef(false)

  useEffect(() => {
    if (!pending) return
    let cancelled = false

    void applyPendingInviteSession().then((result) => {
      if (!cancelled) setOutcome(result)
    })

    return () => {
      cancelled = true
    }
  }, [pending])

  useEffect(() => {
    if (!pending || outcome === null || navigated.current) return

    // A session was established: wait for it to be visible to the tree.
    // Otherwise wait only for the initial restore to finish.
    const ready = outcome === 'applied' ? status === 'authenticated' : status !== 'loading'
    if (!ready) return

    navigated.current = true
    void router.navigate('/auth/accept-invite', { replace: true }).finally(() => {
      setReleased(true)
    })
  }, [pending, outcome, status])

  if (!released) {
    return (
      <div
        className="bg-background text-muted-foreground flex min-h-screen items-center justify-center gap-3 text-xs"
        role="status"
        aria-live="polite"
      >
        <CircleNotch className="size-4 animate-spin" aria-hidden="true" />
        Completing your invitation…
      </div>
    )
  }

  return <>{children}</>
}
