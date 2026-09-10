import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormFailure } from '@/components/common/FormFailure'
import type { Team } from '@/services/team.service'
import { defaultsForNew, defaultsFromTeam, teamFormSchema, toTeamPatch } from './team-form'
import type { TeamFormValues } from './team-form'
import { TeamFormFields } from './TeamFormFields'
import type { useTeamMutations } from './use-teams'

/**
 * Changing a team's name or what it is for.
 *
 * Only those two. The organization, the author, the archive and every id are
 * not fields here — `update_team` takes none of them, so there is nowhere to
 * send one even if a form offered it.
 */
export function EditTeamDialog({
  team,
  open,
  onOpenChange,
  mutations,
}: {
  team: Team | null
  open: boolean
  onOpenChange: (open: boolean) => void
  mutations: ReturnType<typeof useTeamMutations>
}) {
  const { update } = mutations

  const form = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: team ? defaultsFromTeam(team) : defaultsForNew(),
  })

  /*
   * Fill the fields when the dialog opens, and only then.
   *
   * This used to run on `team.updatedAt` as well, which turned out to be a
   * race with the write it was reacting to: saving invalidates the team, the
   * refetch brings a new `updatedAt`, and the effect fired — calling
   * `update.reset()` on the mutation that was still settling. A reset mutation
   * never runs its callbacks, so the dialog stayed open and said nothing,
   * while the rename had already landed in the database. It passed alone and
   * failed under load, which is what a race looks like.
   *
   * Opening is the only moment the fields need filling. It also means a
   * refetch arriving while somebody is typing no longer discards what they
   * typed.
   */
  useEffect(() => {
    if (open && team) {
      form.reset(defaultsFromTeam(team))
      update.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = (values: TeamFormValues) => {
    update.mutate(toTeamPatch(values), {
      onSuccess: () => {
        onOpenChange(false)
        toast.success('Team updated.')
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (update.isPending) return
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
            <DialogTitle className="text-[15px]">Edit team</DialogTitle>
            <DialogDescription className="mt-1">
              What it is called, and what it is for.
            </DialogDescription>
          </div>

          <div className="space-y-3 px-5 py-4">
            <TeamFormFields form={form} autoFocus />
            <FormFailure error={update.isError ? update.error : null} />
          </div>

          <div className="border-border-subtle flex justify-end gap-2 border-t px-5 py-3">
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
            <Button type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
              Save changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
