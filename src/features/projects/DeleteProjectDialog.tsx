import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Warning } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormFailure } from '@/components/common/FormFailure'
import { projectService, type Project } from '@/services/project.service'
import { queryKeys } from '@/lib/query-keys'

/**
 * Deleting a project, which is not archiving one.
 *
 * Archiving puts a project away with everything on it and can be undone. This
 * takes the project and every row that references it — the board, the labels,
 * the comments on every task, the review conversation, the roster — and there
 * is nothing to bring back afterwards. The two are a sentence apart in the
 * interface and must not read as variations on the same idea, so this one says
 * exactly what goes and says that it cannot be undone.
 *
 * No typed confirmation. Nothing else in this application asks somebody to
 * spell a word to prove they meant it, and inventing the convention here would
 * make one dialog behave unlike every other. What it does instead is the thing
 * that actually prevents accidents: the destructive button is not where the
 * safe one was, it is not the default, and the dialog names the project.
 *
 * The audit entry outlives the project: the routine writes it first, in the
 * same transaction.
 */
export function DeleteProjectDialog({
  project,
  onOpenChange,
  onDeleted,
}: {
  project: Project | null
  onOpenChange: (open: boolean) => void
  /** Where to go once the thing being looked at no longer exists. */
  onDeleted?: () => void
}) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => {
      if (!project) throw new Error('No project to delete')
      return projectService.remove(project.id)
    },
    onSuccess: async () => {
      toast.success('Project deleted.')
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all(project?.organizationId ?? 'none'),
      })
      onOpenChange(false)
      onDeleted?.()
    },
  })

  return (
    <Dialog
      open={project !== null}
      onOpenChange={(next) => {
        if (mutation.isPending) return
        mutation.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">
            {project ? `Delete “${project.name}”?` : 'Delete project?'}
          </DialogTitle>
          <DialogDescription className="mt-1">
            This permanently deletes the project, its tasks, comments, labels and roster. It cannot
            be undone.
          </DialogDescription>
        </div>

        <div className="border-border-subtle bg-background text-muted-foreground border-y px-5 py-3">
          <p className="text-2xs flex items-start gap-2">
            <Warning aria-hidden="true" className="text-destructive mt-px size-3.5 shrink-0" />
            <span>
              To keep the project and its history, archive it instead — an archived project stays
              where it is and can be restored.
            </span>
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <FormFailure error={mutation.isError ? mutation.error : null} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => {
                onOpenChange(false)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={mutation.isPending}
              onClick={() => {
                mutation.mutate()
              }}
            >
              Delete project
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
