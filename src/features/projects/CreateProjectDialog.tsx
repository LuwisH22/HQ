import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormFailure } from '@/components/common/FormFailure'
import { projectService } from '@/services/project.service'
import { queryKeys } from '@/lib/query-keys'
import { defaultsForNew, projectFormSchema, toProjectInput } from './project-form'
import type { ProjectFormValues } from './project-form'
import { ProjectFormFields } from './ProjectFormFields'

/**
 * Starting a project.
 *
 * The whole of the authorization is elsewhere: this dialog only opens for
 * somebody the permission set says holds `projects.create`, and the routine
 * behind `projectService.create` asks Postgres the same question again with
 * the caller's own JWT. Hiding the button is a courtesy; the refusal is the
 * control.
 *
 * Whoever starts a project is put on it by the routine, so a new project
 * already has somebody it is for.
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
  organizationId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  /** Handed the new project's id, for a caller that wants to go and look. */
  onCreated?: (projectId: string) => void
}) {
  const queryClient = useQueryClient()

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: defaultsForNew(),
  })

  // Reset rather than remount, so the dialog's own animation is not cut off.
  useEffect(() => {
    if (open) form.reset(defaultsForNew())
    // `form` is stable; resetting on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const mutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      projectService.create(toProjectInput(values, organizationId)),
    onSuccess: async (projectId) => {
      toast.success('Project created.')
      // Only the projects: every list for this organization is stale, and
      // nothing else in the application is.
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(organizationId) })
      onOpenChange(false)
      onCreated?.(projectId)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (mutation.isPending) return
        mutation.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="top-3 flex max-h-[92dvh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-1/2 sm:max-h-[88dvh] sm:max-w-lg sm:-translate-y-1/2">
        <div className="border-border-subtle shrink-0 border-b px-5 py-4">
          <p className="display-eyebrow text-3xs text-muted-foreground">Projects</p>
          <DialogTitle className="mt-1 text-[15px]">New project</DialogTitle>
          <DialogDescription className="mt-1">
            Everybody in this organization who can see projects will see it.
          </DialogDescription>
        </div>

        <form
          id="create-project"
          noValidate
          onSubmit={form.handleSubmit((values) => {
            mutation.mutate(values)
          })}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          <FormFailure error={mutation.isError ? mutation.error : null} />
          <ProjectFormFields form={form} autoFocus showStage />
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
          <Button type="submit" form="create-project" loading={mutation.isPending}>
            Create project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
