import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormFailure } from '@/components/common/FormFailure'
import { projectService, type Project } from '@/services/project.service'
import { queryKeys } from '@/lib/query-keys'
import { PROJECT_STATUS_LABELS } from './project-status'

/**
 * Putting a project away.
 *
 * A confirmation because it changes what the organization sees, not because it
 * destroys anything: nothing is deleted, the project keeps everything on it,
 * and it can be brought back by editing its status. That is why this asks
 * rather than warns, and why the button is not destructive-red.
 *
 * The routine decides who may — `projects.delete`, which the permission
 * catalogue describes as "Archive or delete a project". A failure keeps this
 * open with the reason on it.
 */
export function ArchiveProjectDialog({
  project,
  onOpenChange,
  onArchived,
}: {
  project: Project | null
  onOpenChange: (open: boolean) => void
  /** Lets a caller close whatever was showing the project. */
  onArchived?: () => void
}) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => {
      if (!project) throw new Error('No project to archive')
      return projectService.archive(project.id)
    },
    onSuccess: async () => {
      toast.success('Project archived.')
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all(project?.organizationId ?? 'none'),
      })
      onOpenChange(false)
      onArchived?.()
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
          <DialogTitle className="text-[15px]">Archive project?</DialogTitle>
          <DialogDescription className="mt-1">
            It moves out of the way and keeps everything on it. You can bring it back later.
          </DialogDescription>
        </div>

        {project ? (
          <div className="border-border-subtle bg-background border-y px-5 py-3">
            <p className="display-eyebrow text-3xs text-muted-foreground">
              {PROJECT_STATUS_LABELS[project.status]}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold">{project.name}</p>
          </div>
        ) : null}

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
              variant="secondary"
              loading={mutation.isPending}
              onClick={() => {
                mutation.mutate()
              }}
            >
              Archive project
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
