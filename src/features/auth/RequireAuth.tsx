import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { CircleNotch } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/common/states'
import { useAuth } from '@/hooks/use-auth'
import { useWorkspace } from '@/hooks/use-workspace'

function BootScreen({ label }: { label: string }) {
  return (
    <div
      className="bg-background flex min-h-dvh flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
    >
      <CircleNotch className="text-muted-foreground size-5 animate-spin" aria-hidden="true" />
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  )
}

/**
 * Route guard.
 *
 * Blocks rendering until both the session and the membership are resolved, so
 * the app never flashes a signed-in shell it then tears down — and never
 * renders a workspace before knowing what the member is allowed to see.
 */
export function RequireAuth() {
  const { status: authStatus, signOut } = useAuth()
  const workspace = useWorkspace()
  const location = useLocation()

  if (authStatus === 'loading') {
    return <BootScreen label="Restoring your session…" />
  }

  if (authStatus === 'unauthenticated') {
    const redirectTo = `${location.pathname}${location.search}`
    return (
      <Navigate
        to={`/auth/sign-in${redirectTo !== '/' ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ''}`}
        replace
      />
    )
  }

  if (workspace.status === 'loading') {
    return <BootScreen label="Loading your workspace…" />
  }

  if (workspace.status === 'error') {
    return (
      <div className="bg-background flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-md">
          <ErrorState error={workspace.error} onRetry={() => void workspace.refresh()} />
        </div>
      </div>
    )
  }

  if (workspace.status === 'no-organization') {
    return (
      <div className="bg-background flex min-h-dvh items-center justify-center p-6">
        <div className="border-border bg-surface w-full max-w-md space-y-4 rounded-lg border p-6 text-center">
          <h1 className="text-base font-semibold">No organization yet</h1>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Your account exists but is not a member of any organization. If you were invited, open
            the invitation link from your email. Otherwise ask an admin to invite you.
          </p>
          <div className="flex justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void workspace.refresh()}>
              Check again
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (workspace.membership?.status === 'suspended') {
    return (
      <div className="bg-background flex min-h-dvh items-center justify-center p-6">
        <div className="border-border bg-surface w-full max-w-md space-y-4 rounded-lg border p-6 text-center">
          <h1 className="text-base font-semibold">Your access is suspended</h1>
          <p className="text-muted-foreground text-xs leading-relaxed">
            An administrator has paused your membership. Contact them to restore access.
          </p>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    )
  }

  return <Outlet />
}

/** Inverse guard: keeps signed-in users off the auth screens. */
export function RedirectIfAuthenticated() {
  const { status } = useAuth()
  if (status === 'loading') return <BootScreen label="Checking your session…" />
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <Outlet />
}
