import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/common/FormField'
import { resetPasswordSchema, type ResetPasswordValues } from './schemas'

/**
 * Choose a password for an account that does not have one yet.
 *
 * Shares `resetPasswordSchema` with the recovery screen so the rules cannot
 * drift apart. The caller owns the submit, because what happens on success
 * differs between "finish joining" and "finish recovering".
 */
export function SetPasswordForm({
  onSubmit,
  submitLabel = 'Set password and continue',
}: {
  onSubmit: (password: string) => Promise<void>
  submitLabel?: string
}) {
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  return (
    <form
      onSubmit={form.handleSubmit((values) => onSubmit(values.password))}
      className="space-y-4"
      noValidate
    >
      <FormField label="Password" error={form.formState.errors.password?.message} required>
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
        {submitLabel}
      </Button>
    </form>
  )
}
