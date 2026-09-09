import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Trash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormFailure } from '@/components/common/FormFailure'
import type { ProjectMember } from '@/services/project.service'
import type { Label } from '@/services/label.service'
import type { Task } from '@/services/task.service'
import { useAuth } from '@/hooks/use-auth'
import type { TaskStatus } from '@/types/database.types'
import { errorMessage } from '@/lib/errors'
import { formatTimestamp } from '@/utils/datetime'
import { defaultsForNewTask, defaultsFromTask, taskFormSchema, toTaskPatch } from './task-form'
import type { TaskFormValues } from './task-form'
import { TaskFormFields } from './TaskFormFields'
import { TASK_STATUSES, TASK_STATUS_LABELS } from './task-status'
import type { useTaskMutations } from './use-tasks'
import type { useLabelMutations } from './use-labels'
import { LabelChip } from './LabelChip'
import { LabelPicker } from './LabelPicker'
import { TaskComments } from './TaskComments'

/**
 * One task, open.
 *
 * The properties are a form and the column is not: changing the column is a
 * move, because where a task sits in a column and whether it counts as
 * finished are decided together, by the routine, in one statement.
 *
 * The assignee is saved by its own routine as well, since it is its own
 * permission — somebody may be trusted to reword a task without being trusted
 * to put it on another person.
 */
export function TaskDetailDialog({
  task,
  members,
  labels,
  labelMutations,
  organizationId,
  onOpenChange,
  canManage,
  canAssign,
  canComment,
  mutations,
}: {
  task: Task | null
  members: ProjectMember[]
  /** The project's own labels, which are the only ones a task may take. */
  labels: Label[]
  labelMutations: ReturnType<typeof useLabelMutations>
  organizationId: string | undefined
  onOpenChange: (open: boolean) => void
  canManage: boolean
  canAssign: boolean
  /**
   * Whether comments may be written here.
   *
   * Saying something about a task asks for `tasks.view` — the same thing
   * reading it asks for — so anybody looking at this may comment. What takes
   * it away is an archived project, which is what this carries.
   */
  canComment: boolean
  mutations: ReturnType<typeof useTaskMutations>
}) {
  const { update, assign, move, remove } = mutations
  const { user } = useAuth()
  const onTask = new Set(task?.labelIds ?? [])

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: task ? defaultsFromTask(task) : defaultsForNewTask(),
  })

  useEffect(() => {
    if (task) form.reset(defaultsFromTask(task))
    // `form` is stable; resetting on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.updatedAt])

  const save = (values: TaskFormValues) => {
    if (!task) return
    const assignee = values.assigneeId || null

    update.mutate(
      { taskId: task.id, patch: toTaskPatch(values) },
      {
        onSuccess: () => {
          // Only when it changed, and only through the routine that owns it.
          if (assignee !== task.assigneeId && canAssign) {
            assign.mutate({ taskId: task.id, assigneeId: assignee })
          }
          toast.success('Task updated.')
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={task !== null}
      onOpenChange={(next) => {
        if (update.isPending) return
        update.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="top-3 flex max-h-[92dvh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-1/2 sm:max-h-[88dvh] sm:max-w-lg sm:-translate-y-1/2">
        <div className="border-border-subtle shrink-0 border-b px-5 py-4">
          <p className="display-eyebrow text-3xs text-muted-foreground">Task</p>
          <DialogTitle className="mt-1 text-[15px]">{task ? task.title : 'Task'}</DialogTitle>
          <DialogDescription className="mt-1">
            {task
              ? `Added ${formatTimestamp(task.createdAt)}${
                  task.completedAt ? ` · finished ${formatTimestamp(task.completedAt)}` : ''
                }`
              : ''}
          </DialogDescription>
        </div>

        {task ? (
          <>
            <div className="border-border-subtle bg-background flex items-center gap-3 border-b px-5 py-3">
              <span className="display-eyebrow text-3xs text-muted-foreground">Column</span>
              <Select
                value={task.status}
                disabled={!canManage || move.isPending}
                onValueChange={(value) => {
                  // A column change is a move: the routine decides the place
                  // in the column and whether it is finished.
                  move.mutate({ taskId: task.id, status: value as TaskStatus, index: 99 })
                }}
              >
                <SelectTrigger className="h-7 w-44" aria-label="Column">
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
            </div>

            {/* One scrolling region for the whole task: the fields, what it
                is labelled, and what has been said about it. Two would mean
                two scrollbars and a description cut off by the section under
                it. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <form
                id="edit-task"
                noValidate
                onSubmit={form.handleSubmit(save)}
                className="space-y-4 px-5 py-4"
              >
                <FormFailure error={update.isError ? update.error : null} />
                <TaskFormFields form={form} members={members} canAssign={canAssign} />
              </form>

              {/* Outside the form on purpose: a label goes on the moment it is
                  chosen, and the composer below is a form of its own. */}
              <div className="border-border-subtle space-y-4 border-t px-5 py-4">
                <section aria-labelledby="task-labels" className="space-y-2">
                  <h3 id="task-labels" className="display-eyebrow text-3xs text-muted-foreground">
                    Labels
                  </h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {labels
                      .filter((label) => onTask.has(label.id))
                      .map((label) => (
                        <LabelChip
                          key={label.id}
                          label={label}
                          onRemove={
                            canManage
                              ? () => {
                                  labelMutations.unassign.mutate({
                                    taskId: task.id,
                                    labelId: label.id,
                                  })
                                }
                              : undefined
                          }
                        />
                      ))}

                    {canManage ? (
                      <LabelPicker
                        labels={labels}
                        selected={onTask}
                        canManage={canManage}
                        busy={labelMutations.assign.isPending || labelMutations.create.isPending}
                        onToggle={(label, isOn) => {
                          if (isOn) {
                            labelMutations.unassign.mutate({ taskId: task.id, labelId: label.id })
                          } else {
                            labelMutations.assign.mutate({ taskId: task.id, labelId: label.id })
                          }
                        }}
                        onCreate={(name) => {
                          labelMutations.create.mutate(
                            { name },
                            {
                              onSuccess: (labelId) => {
                                // Made because this task needed it, so it goes
                                // straight on.
                                labelMutations.assign.mutate({ taskId: task.id, labelId })
                              },
                            },
                          )
                        }}
                      />
                    ) : null}

                    {!canManage && onTask.size === 0 ? (
                      <p className="text-muted-foreground/70 text-xs">None.</p>
                    ) : null}
                  </div>
                </section>

                <TaskComments
                  organizationId={organizationId}
                  taskId={task.id}
                  currentUserId={user?.id ?? null}
                  canModerate={canManage}
                  canWrite={canComment}
                />
              </div>
            </div>

            <div className="border-border-subtle bg-elevated flex shrink-0 items-center gap-2 border-t px-5 py-3">
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive mr-auto"
                  loading={remove.isPending}
                  onClick={() => {
                    remove.mutate(task.id, {
                      onSuccess: () => {
                        toast.success('Task deleted.')
                        onOpenChange(false)
                      },
                      onError: (error) => {
                        toast.error(errorMessage(error))
                      },
                    })
                  }}
                >
                  <Trash aria-hidden="true" />
                  Delete
                </Button>
              ) : null}

              <Button
                type="button"
                variant="ghost"
                disabled={update.isPending}
                onClick={() => {
                  onOpenChange(false)
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="edit-task"
                loading={update.isPending}
                disabled={!canManage || !form.formState.isDirty}
              >
                Save changes
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
