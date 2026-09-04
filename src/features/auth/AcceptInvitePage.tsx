import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, CircleNotch } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { authService } from '@/services/auth.service'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { useAuth } from '@/hooks/use-auth'
import { useUiStore } from '@/stores/ui.store'
import { AuthLayout } from './AuthLayout'

type Phase = 'waiting-for-session' | 'redeeming' | 'done' | 'error'

/**
 * Redeems an invitation token.
 *
 * The token is not a credential on its own: `accept_invitation` in Postgres
 * also requires the signed-in address to match the invited address, so a leaked
 * link cannot be used by anyone else. That check lives in the database, not
 * here.
 */
export function AcceptInvitePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { status } = useAuth()
  const setActiveOrganization = useUiStore((state) => state.setActiveOrganization)

  const token = searchParams.get('token')
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
        'Open this link from the device where you set your password, or sign in first and then follow the link again.',
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
        setPhase('done')
      })
      .catch((error: unknown) => {
        setPhase('error')
        setMessage(toAppError(error).userMessage)
      })
  }, [token, status, queryClient, setActiveOrganization])

  if (phase === 'done') {
    return (
      <AuthLayout title="You're in" description="Your membership is active.">
        <div className="border-border bg-elevated mb-4 flex items-center gap-3 rounded-md border p-3">
          <CheckCircle className="text-success size-4 shrink-0" aria-hidden="true" />
          <p className="text-muted-foreground text-xs">Welcome to the organization.</p>
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
