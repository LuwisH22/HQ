import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormFailure } from '@/components/common/FormFailure'
import { projectService, type Project } from '@/services/project.service'
import { queryKeys } from '@/lib/query-keys'
import {
  defaultsForNew,
  defaultsFromProject,
  projectFormSchema,
  toProjectPatch,
} from './project-form'
import type { ProjectFormValues } from './project-form'
import { ProjectFormFields } from './ProjectFormFields'

/**
 * Changing a project.
 *
 * The same fields, the same schema and the same conversion as starting one —
 * what differs is where the values come from and which routine is called. The
 * routine decides who may: `projects.manage`, checked again in Postgres with
 * the caller's own JWT.
 *
 * An archived project can be brought back here by choosing a status, because
 * restoring something is not the destructive direction. Archiving is not on
 * the list: that has its own permission and its own confirmation.
 */
export function EditProjectDialog({
  project,
  onOpenChange,
}: {
  /** The project being edited, or null when nothing is. */
  project: Project | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: project ? defaultsFromProject(project) : defaultsForNew(),
  })

  useEffect(() => {
    if (project) form.reset(defaultsFromProject(project))
    // `form` is stable; resetting on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.updatedAt])

  const mutation = useMutation({
    mutationFn: (values: ProjectFormValues) => {
      if (!project) throw new Error('No project to update')
      return projectService.update(project.id, toProjectPatch(values))
    },
    onSuccess: async () => {
      toast.success('Project updated.')
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all(project?.organizationId ?? 'none'),
      })
      onOpenChange(false)
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
      <DialogContent className="top-3 flex max-h-[92dvh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-1/2 sm:max-h-[88dvh] sm:max-w-lg sm:-translate-y-1/2">
        <div className="border-border-subtle shrink-0 border-b px-5 py-4">
          <p className="display-eyebrow text-3xs text-muted-foreground">Projects</p>
          <DialogTitle className="mt-1 text-[15px]">Edit project</DialogTitle>
          <DialogDescription className="mt-1">
            Changes are visible to everybody who can see this project.
          </DialogDescription>
        </div>

        <form
          id="edit-project"
          noValidate
          onSubmit={form.handleSubmit((values) => {
            mutation.mutate(values)
          })}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          <FormFailure error={mutation.isError ? mutation.error : null} />
          {project ? <ProjectFormFields form={form} /> : null}
        </form>

        <div className="border-border-subtle bg-elevated flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
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
            type="submit"
            form="edit-project"
            loading={mutation.isPending}
            disabled={!form.formState.isDirty}
          >
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
