import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { EnvelopeSimpleOpen, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/common/FormField'
import { authService } from '@/services/auth.service'
import { errorMessage, toAppError } from '@/lib/errors'
import { envResult } from '@/lib/env'
import { DemoSignIn } from '@/features/demo'
import { AuthLayout } from './AuthLayout'
import { magicLinkSchema, signInSchema, type MagicLinkValues, type SignInValues } from './schemas'

type Mode = 'password' | 'magic-link'

/**
 * Sign-in.
 *
 * There is no "create account" path anywhere on this screen, by design: LFG HQ
 * is invitation-only and the Supabase project has signups disabled, so an
 * unknown email simply cannot get in.
 */
export function SignInPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>('password')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const redirectTo = searchParams.get('redirectTo') ?? '/'

  // Without Supabase credentials the real forms cannot work, so they are
  // hidden rather than shown as controls that always fail.
  const backendConfigured = envResult.ok

  const passwordForm = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })

  const magicForm = useForm<MagicLinkValues>({
    resolver: zodResolver(magicLinkSchema),
    defaultValues: { email: '' },
  })

  async function onPasswordSubmit(values: SignInValues) {
    setFormError(null)
    try {
      await authService.signInWithPassword(values)
      void navigate(redirectTo, { replace: true })
    } catch (error) {
      const appError = toAppError(error)
      setFormError(appError.userMessage)
      // Never reveal which half was wrong — that turns the form into an
      // account-enumeration oracle.
      passwordForm.resetField('password')
    }
  }

  async function onMagicLinkSubmit(values: MagicLinkValues) {
    setFormError(null)
    try {
      await authService.signInWithMagicLink(values.email)
      setMagicLinkSent(true)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (magicLinkSent) {
    return (
      <AuthLayout
        title="Check your email"
        description="If that address belongs to a member, a sign-in link is on its way. The link expires in one hour."
      >
        <div className="border-border bg-elevated flex items-center gap-3 rounded-md border p-3">
          <EnvelopeSimpleOpen className="text-success size-4 shrink-0" aria-hidden="true" />
          <p className="text-muted-foreground text-xs">
            Sent to{' '}
            <span className="text-foreground font-medium">{magicForm.getValues('email')}</span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 w-full"
          onClick={() => {
            setMagicLinkSent(false)
            setMode('password')
          }}
        >
          Back to sign in
        </Button>
      </AuthLayout>
    )
  }

  // No Supabase project is configured. Rather than presenting forms that can
  // only fail, say so plainly and offer the development entry point.
  if (!backendConfigured) {
    return (
      <AuthLayout
        title="No backend configured"
        description="LFG HQ has no Supabase project to sign in against yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env and restart the dev server."
      >
        <DemoSignIn standalone />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Sign in"
      description="LFG HQ is invitation-only. Use the account your organization set up for you."
    >
      {formError ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mb-4 flex items-start gap-2 rounded-sm border px-3 py-2 text-xs"
        >
          <WarningCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{formError}</span>
        </div>
      ) : null}

      {mode === 'password' ? (
        <form
          onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
          className="space-y-4"
          noValidate
        >
          <FormField label="Email" error={passwordForm.formState.errors.email?.message} required>
            {(props) => (
              <Input
                {...props}
                {...passwordForm.register('email')}
                type="email"
                autoComplete="username"
                autoFocus
                placeholder="you@organization.gg"
              />
            )}
          </FormField>

          <FormField
            label="Password"
            error={passwordForm.formState.errors.password?.message}
            required
          >
            {(props) => (
              <Input
                {...props}
                {...passwordForm.register('password')}
                type="password"
                autoComplete="current-password"
              />
            )}
          </FormField>

          <Button type="submit" className="w-full" loading={passwordForm.formState.isSubmitting}>
            Sign in
          </Button>

          <div className="text-center">
            <Link
              to="/auth/forgot-password"
              className="text-accent-text hover:text-accent-glow text-xs underline-offset-4 hover:underline"
            >
              Forgot your password?
            </Link>
          </div>
        </form>
      ) : (
        <form onSubmit={magicForm.handleSubmit(onMagicLinkSubmit)} className="space-y-4" noValidate>
          <FormField
            label="Email"
            error={magicForm.formState.errors.email?.message}
            hint="We will only send a link to an address that already has an account."
            required
          >
            {(props) => (
              <Input
                {...props}
                {...magicForm.register('email')}
                type="email"
                autoComplete="username"
                autoFocus
                placeholder="you@organization.gg"
              />
            )}
          </FormField>

          <Button type="submit" className="w-full" loading={magicForm.formState.isSubmitting}>
            Send sign-in link
          </Button>
        </form>
      )}

      {/* The other way in, under a rule rather than in the footer: it is an
          alternative to the form above it, not a note about the page. */}
      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="border-border-subtle flex-1 border-t" />
        <span className="text-2xs text-muted-foreground font-mono">or</span>
        <span className="border-border-subtle flex-1 border-t" />
      </div>

      <Button
        type="button"
        variant="secondary"
        size="xl"
        className="w-full"
        onClick={() => {
          setMode(mode === 'password' ? 'magic-link' : 'password')
          setFormError(null)
        }}
      >
        {mode === 'password' ? 'Email me a sign-in link' : 'Sign in with a password'}
      </Button>

      <DemoSignIn />
    </AuthLayout>
  )
}
