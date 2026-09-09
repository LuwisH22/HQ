import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormFailure } from '@/components/common/FormFailure'
import type { ProjectMember } from '@/services/project.service'
import type { TaskStatus } from '@/types/database.types'
import { defaultsForNewTask, taskFormSchema, toTaskInput } from './task-form'
import type { TaskFormValues } from './task-form'
import { TaskFormFields } from './TaskFormFields'
import { TASK_STATUS_LABELS } from './task-status'
import type { useTaskMutations } from './use-tasks'

/**
 * Adding work to a project.
 *
 * Opens in the column the plus was pressed in, because that is the answer to
 * "which column" that somebody has already given. The routine puts it at the
 * end of that column and refuses the whole thing if the project is archived.
 */
export function CreateTaskDialog({
  open,
  onOpenChange,
  projectId,
  status,
  members,
  canAssign,
  mutations,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  /** The column the plus was pressed in. */
  status: TaskStatus
  members: ProjectMember[]
  canAssign: boolean
  mutations: ReturnType<typeof useTaskMutations>
}) {
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: defaultsForNewTask(status),
  })

  useEffect(() => {
    if (open) form.reset(defaultsForNewTask(status))
    // `form` is stable; resetting on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status])

  const { create } = mutations

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return
        create.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="top-3 flex max-h-[92dvh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-1/2 sm:max-h-[88dvh] sm:max-w-lg sm:-translate-y-1/2">
        <div className="border-border-subtle shrink-0 border-b px-5 py-4">
          <p className="display-eyebrow text-3xs text-muted-foreground">
            {TASK_STATUS_LABELS[status]}
          </p>
          <DialogTitle className="mt-1 text-[15px]">New task</DialogTitle>
          <DialogDescription className="mt-1">
            It lands at the bottom of that column.
          </DialogDescription>
        </div>

        <form
          id="create-task"
          noValidate
          onSubmit={form.handleSubmit((values) => {
            create.mutate(toTaskInput(values, projectId), {
              onSuccess: () => {
                toast.success('Task added.')
                onOpenChange(false)
              },
            })
          })}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          <FormFailure error={create.isError ? create.error : null} />
          <TaskFormFields
            form={form}
            members={members}
            canAssign={canAssign}
            showStatus
            autoFocus
          />
        </form>

        <div className="border-border-subtle bg-elevated flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={create.isPending}
            onClick={() => {
              onOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button type="submit" form="create-task" loading={create.isPending}>
            Add task
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
