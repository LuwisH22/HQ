import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormFailure } from '@/components/common/FormFailure'
import { defaultsForNew, teamFormSchema, type TeamFormValues } from './team-form'
import { TeamFormFields } from './TeamFormFields'
import { useTeamMutations } from './use-teams'

/**
 * Starting a team.
 *
 * The roster is not asked for here. A team is created empty and filled on
 * purpose — partly because who is on a side is its own permission, and partly
 * because naming a team and picking it are two decisions that rarely happen in
 * the same minute.
 *
 * What comes back is the team's id, and the id is what this navigates to: the
 * next thing anybody wants after making a team is to put people on it.
 */
export function CreateTeamDialog({
  organizationId,
  open,
  onOpenChange,
}: {
  organizationId: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { create } = useTeamMutations(organizationId)

  const form = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: defaultsForNew(),
  })

  useEffect(() => {
    if (open) {
      form.reset(defaultsForNew())
      create.reset()
    }
    // `form` and `create` are stable; resetting on their identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = (values: TeamFormValues) => {
    create.mutate(
      { name: values.name.trim(), description: values.description.trim() || null },
      {
        onSuccess: (teamId) => {
          onOpenChange(false)
          toast.success('Team created.')
          void navigate(`/teams/${teamId}`)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return
        onOpenChange(next)
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            void form.handleSubmit(submit)(event)
          }}
        >
          <div className="px-5 pt-5 pb-3">
            <DialogTitle className="text-[15px]">New team</DialogTitle>
            <DialogDescription className="mt-1">
              A side, a squad or a staff group. You can add people to it next.
            </DialogDescription>
          </div>

          <div className="space-y-3 px-5 py-4">
            <TeamFormFields form={form} autoFocus />
            <FormFailure error={create.isError ? create.error : null} />
          </div>

          <div className="border-border-subtle flex justify-end gap-2 border-t px-5 py-3">
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
            <Button type="submit" loading={create.isPending}>
              Create team
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
