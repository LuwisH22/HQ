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
import type { ProjectMember } from '@/services/project.service'
import { displayNameFor } from '@/services/profile.service'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
} from './task-status'
import type { TaskFormValues } from './task-form'

/** Radix wants a value; nobody is not an empty string to it. */
const NOBODY = 'nobody'

/**
 * The fields a task has, wherever it is being written.
 *
 * Adding one and changing one ask for the same things, so they share the
 * fields. Status is offered only when adding: on a task that already exists it
 * lives on the board, where moving it also decides where in the column it
 * lands and whether it counts as finished.
 *
 * The assignee list is the project's roster and nothing wider — the database
 * refuses anybody else, and offering a name that would be refused is a worse
 * failure than not offering it.
 */
export function TaskFormFields({
  form,
  members,
  autoFocus = false,
  showStatus = false,
  canAssign,
}: {
  form: UseFormReturn<TaskFormValues>
  members: ProjectMember[]
  autoFocus?: boolean
  showStatus?: boolean
  canAssign: boolean
}) {
  return (
    <>
      <FormField label="Title" error={form.formState.errors.title?.message} required>
        {(props) => (
          <Input
            {...props}
            {...form.register('title')}
            autoFocus={autoFocus}
            placeholder="Book the practice room"
            maxLength={200}
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        {showStatus ? (
          <FormField label="Column" error={form.formState.errors.status?.message} required>
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
                      {TASK_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {TASK_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </FormField>
        ) : null}

        <FormField label="Priority" error={form.formState.errors.priority?.message} required>
          {(props) => (
            <Controller
              control={form.control}
              name="priority"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {TASK_PRIORITY_LABELS[priority]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Assignee"
          error={form.formState.errors.assigneeId?.message}
          hint={canAssign ? 'Anybody on this project.' : undefined}
        >
          {(props) => (
            <Controller
              control={form.control}
              name="assigneeId"
              render={({ field }) => (
                <Select
                  value={field.value === '' ? NOBODY : field.value}
                  onValueChange={(value) => {
                    field.onChange(value === NOBODY ? '' : value)
                  }}
                  disabled={!canAssign}
                >
                  <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOBODY}>Nobody</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.memberId} value={member.memberId}>
                        {displayNameFor(member.profile)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
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
            maxLength={4000}
            placeholder="What needs doing, and anything the person picking it up should know."
          />
        )}
      </FormField>
    </>
  )
}
