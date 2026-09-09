import { Controller, type UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/common/FormField'
import { PROJECT_STATUS_LABELS, SELECTABLE_STATUSES } from './project-status'
import type { ProjectFormValues } from './project-form'

/**
 * The fields a project has, wherever it is being written.
 *
 * Starting one and changing one ask for exactly the same things and validate
 * them in exactly the same way, so they share the fields rather than keeping
 * two copies that drift. What differs between the two dialogs is the title,
 * the verb on the button and which routine is called — not the form.
 *
 * Archiving is not in the status list on purpose: it is a separate action with
 * a separate permission, and a dropdown that could quietly archive something
 * would be an authorization decision hidden in a field.
 */
export function ProjectFormFields({
  form,
  autoFocus = false,
}: {
  form: UseFormReturn<ProjectFormValues>
  autoFocus?: boolean
}) {
  return (
    <>
      <FormField label="Name" error={form.formState.errors.name?.message} required>
        {(props) => (
          <Input
            {...props}
            {...form.register('name')}
            autoFocus={autoFocus}
            placeholder="Spring bootcamp"
            maxLength={120}
          />
        )}
      </FormField>

      <FormField label="Status" error={form.formState.errors.status?.message} required>
        {(props) => (
          <Controller
            control={form.control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SELECTABLE_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {PROJECT_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Starts" error={form.formState.errors.startDate?.message} hint="Optional.">
          {(props) => (
            <Input {...props} type="date" {...form.register('startDate')} className="font-mono" />
          )}
        </FormField>

        <FormField label="Due" error={form.formState.errors.dueDate?.message} hint="Optional.">
          {(props) => (
            <Input {...props} type="date" {...form.register('dueDate')} className="font-mono" />
          )}
        </FormField>
      </div>

      <FormField label="Description" error={form.formState.errors.description?.message}>
        {(props) => (
          <Textarea
            {...props}
            {...form.register('description')}
            rows={3}
            className="resize-y"
            maxLength={2000}
            placeholder="What it is for, who it is with, anything the team should know."
          />
        )}
      </FormField>
    </>
  )
}
