import { type UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FormField } from '@/components/common/FormField'
import type { TeamFormValues } from './team-form'

/**
 * The two things a team has.
 *
 * Naming one and changing one ask for exactly the same things and validate
 * them in exactly the same way, so they share the fields rather than keeping
 * two copies that drift. What differs between the dialogs is the title, the
 * verb on the button and which routine is called — not the form.
 *
 * No game, region, logo, roster size or ranking: none of those are columns,
 * and a field with nowhere to go is a promise the product has not made.
 */
export function TeamFormFields({
  form,
  autoFocus = false,
}: {
  form: UseFormReturn<TeamFormValues>
  autoFocus?: boolean
}) {
  return (
    <div className="space-y-4">
      <FormField label="Name" error={form.formState.errors.name?.message} required>
        {(props) => (
          <Input
            {...props}
            {...form.register('name')}
            autoFocus={autoFocus}
            placeholder="Valorant Main"
            maxLength={80}
          />
        )}
      </FormField>

      <FormField
        label="Description"
        error={form.formState.errors.description?.message}
        hint="Optional."
      >
        {(props) => (
          <Textarea
            {...props}
            {...form.register('description')}
            placeholder="Who this side is and what they play."
            className="min-h-20"
            maxLength={2000}
          />
        )}
      </FormField>
    </div>
  )
}
