import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, CircleNotch, Warning } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { authService } from '@/services/auth.service'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { useAuth } from '@/hooks/use-auth'
import { useUiStore } from '@/stores/ui.store'
import { AuthLayout } from './AuthLayout'
import { SetPasswordForm } from './SetPasswordForm'
import { consumeInviteToken } from './invite-token'

type Phase =
  'waiting-for-session' | 'redeeming' | 'set-password' | 'password-failed' | 'done' | 'error'

/**
 * Redeems an invitation, then lets the new member choose a password.
 *
 * The token is not a credential on its own: `accept_invitation` in Postgres
 * also requires the invitation to be pending, unexpired, and issued to the
 * signed-in address. Those checks live in the database, not here.
 *
 * Order is deliberate — redeem first, password second. The token exists only
 * in memory and has already been stripped from the URL, so a refresh destroys
 * it; the password can always be set later through recovery. Redeeming while
 * the token is certainly in hand therefore fails safe. The reverse order would
 * risk stranding a valid invitation with no way to reach it.
 *
 * That choice creates one partial-failure state worth naming: membership
 * granted, password not set. It is explicitly *not* an invitation failure, and
 * the UI must never send the user back for a fresh invite — they are already a
 * member, and recovery is all they need.
 */
export function AcceptInvitePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { status, user } = useAuth()
  const setActiveOrganization = useUiStore((state) => state.setActiveOrganization)

  // Either the landing URL captured it before React booted, or it is on the
  // hash route (a link opened while already signed in). Consumed once and held
  // for the lifetime of this mount only.
  const tokenRef = useRef<string | null>(null)
  if (tokenRef.current === null) {
    tokenRef.current = consumeInviteToken() ?? searchParams.get('token')
  }
  const token = tokenRef.current

  const [phase, setPhase] = useState<Phase>('waiting-for-session')
  const [message, setMessage] = useState<string>('')
  // Supabase may emit more than one auth event while establishing the session;
  // redeeming twice would surface a spurious "already used" error.
  const redeemed = useRef(false)

  useEffect(() => {
    if (!token) {
      setPhase('error')
      setMessage('This invitation link is missing its token. Ask for a fresh invite.')
      return
    }
    if (status === 'loading') return
    if (status === 'unauthenticated') {
      setPhase('error')
      setMessage(
        'This invitation link has expired or has already been used. Ask for a fresh invite.',
      )
      return
    }
    if (redeemed.current) return

    redeemed.current = true
    setPhase('redeeming')

    void authService
      .acceptInvitation(token)
      .then(async (organizationId) => {
        setActiveOrganization(organizationId)
        await queryClient.invalidateQueries({ queryKey: queryKeys.organizations.mine() })
        setPhase('set-password')
      })
      .catch((error: unknown) => {
        setPhase('error')
        setMessage(toAppError(error).userMessage)
      })
  }, [token, status, queryClient, setActiveOrganization])

  async function handleSetPassword(password: string): Promise<void> {
    try {
      await authService.updatePassword(password)
      setPhase('done')
    } catch (error: unknown) {
      // Membership already succeeded. Say so plainly, and offer recovery
      // rather than implying the invitation needs redoing.
      setMessage(toAppError(error).userMessage)
      setPhase('password-failed')
    }
  }

  if (phase === 'set-password') {
    return (
      <AuthLayout
        title="Choose a password"
        description="You're a member now. Set a password so you can sign in from any device."
      >
        <SetPasswordForm onSubmit={handleSetPassword} />
      </AuthLayout>
    )
  }

  if (phase === 'password-failed') {
    return (
      <AuthLayout
        title="You're in — but the password did not save"
        description="Your membership is active. Only the password step failed, so there is no need for another invitation."
      >
        <div className="border-border bg-elevated mb-4 flex items-start gap-3 rounded-md border p-3">
          <Warning className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="text-muted-foreground text-xs">{message}</p>
        </div>
        <div className="space-y-2">
          <Button className="w-full" onClick={() => setPhase('set-password')}>
            Try again
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void navigate('/auth/forgot-password')}
          >
            Email me a password link instead
          </Button>
        </div>
      </AuthLayout>
    )
  }

  if (phase === 'done') {
    return (
      <AuthLayout title="You're in" description="Your membership is active.">
        <div className="border-border bg-elevated mb-4 flex items-center gap-3 rounded-md border p-3">
          <CheckCircle className="text-success size-4 shrink-0" aria-hidden="true" />
          <p className="text-muted-foreground text-xs">
            Welcome to the organization{user?.email ? `, ${user.email}` : ''}.
          </p>
        </div>
        <Button className="w-full" onClick={() => void navigate('/', { replace: true })}>
          Go to the dashboard
        </Button>
      </AuthLayout>
    )
  }

  if (phase === 'error') {
    return (
      <AuthLayout title="We could not accept this invitation" description={message}>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void navigate('/auth/sign-in', { replace: true })}
        >
          Go to sign in
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Joining the organization" description="This will only take a moment.">
      <div
        className="text-muted-foreground flex items-center gap-3 text-xs"
        role="status"
        aria-live="polite"
      >
        <CircleNotch className="size-4 animate-spin" aria-hidden="true" />
        Verifying your invitation…
      </div>
    </AuthLayout>
  )
}
