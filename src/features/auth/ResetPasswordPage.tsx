import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/common/FormField'
import { authService } from '@/services/auth.service'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/hooks/use-auth'
import { AuthLayout } from './AuthLayout'
import { resetPasswordSchema, type ResetPasswordValues } from './schemas'

/**
 * Set a new password.
 *
 * Reached from the emailed recovery link, which Supabase exchanges for a
 * short-lived session before this renders — so the update below is authorised
 * by that session, not by anything in the URL.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { status } = useAuth()

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  async function onSubmit(values: ResetPasswordValues) {
    try {
      await authService.updatePassword(values.password)
      toast.success('Password updated.')
      void navigate('/', { replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (status === 'unauthenticated') {
    return (
      <AuthLayout
        title="This link is no longer valid"
        description="Password reset links expire after one hour and can only be used once. Request a new one to continue."
      >
        <Button className="w-full" onClick={() => void navigate('/auth/forgot-password')}>
          Request a new link
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Choose a new password" description="Use at least 10 characters.">
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField label="New password" error={form.formState.errors.password?.message} required>
          {(props) => (
            <Input
              {...props}
              {...form.register('password')}
              type="password"
              autoComplete="new-password"
              autoFocus
            />
          )}
        </FormField>

        <FormField
          label="Confirm password"
          error={form.formState.errors.confirmPassword?.message}
          required
        >
          {(props) => (
            <Input
              {...props}
              {...form.register('confirmPassword')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </FormField>

        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
