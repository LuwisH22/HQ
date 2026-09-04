import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/common/FormField'
import { authService } from '@/services/auth.service'
import { errorMessage } from '@/lib/errors'
import { AuthLayout } from './AuthLayout'
import { forgotPasswordSchema, type ForgotPasswordValues } from './schemas'

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(values: ForgotPasswordValues) {
    try {
      await authService.requestPasswordReset(values.email)
      // Confirm unconditionally: telling the visitor whether the address exists
      // would leak the member list of a private organization.
      setSent(true)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        description="If that address belongs to a member, a password reset link is on its way."
      >
        <div className="border-border bg-elevated flex items-center gap-3 rounded-md border p-3">
          <MailCheck className="text-success size-4 shrink-0" aria-hidden="true" />
          <p className="text-muted-foreground text-xs">
            Sent to <span className="text-foreground font-medium">{form.getValues('email')}</span>
          </p>
        </div>
        <Button variant="ghost" size="sm" className="mt-4 w-full" asChild>
          <Link to="/auth/sign-in">Back to sign in</Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter the email address linked to your account."
      footer={
        <Link
          to="/auth/sign-in"
          className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField label="Email" error={form.formState.errors.email?.message} required>
          {(props) => (
            <Input
              {...props}
              {...form.register('email')}
              type="email"
              autoComplete="username"
              autoFocus
              placeholder="you@organization.gg"
            />
          )}
        </FormField>

        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  )
}
