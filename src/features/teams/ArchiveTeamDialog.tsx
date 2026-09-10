import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormFailure } from '@/components/common/FormFailure'
import type { Team } from '@/services/team.service'
import type { useTeamMutations } from './use-teams'

/**
 * Putting a team away.
 *
 * A confirmation because it changes what the organization can do with the
 * team, not because it destroys anything: the roster stays exactly as it is,
 * the team keeps its name, and Restore gives it all back. So this asks rather
 * than warns, and the button is not destructive-red.
 *
 * Nothing here deletes. There is no delete routine behind it to call: teams
 * are what rosters and results will hang off, and a cascade is not an undo.
 */
export function ArchiveTeamDialog({
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
  const { archive } = mutations

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (archive.isPending) return
        archive.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">
            {team ? `Archive “${team.name}”?` : 'Archive team?'}
          </DialogTitle>
          <DialogDescription className="mt-1">
            The team stays, with everybody on it. Roster changes and editing are unavailable until
            it is restored.
          </DialogDescription>
        </div>

        <div className="space-y-3 px-5 py-4">
          <FormFailure error={archive.isError ? archive.error : null} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={archive.isPending}
              onClick={() => {
                onOpenChange(false)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={archive.isPending}
              onClick={() => {
                archive.mutate(undefined, {
                  onSuccess: () => {
                    onOpenChange(false)
                    toast.success('Team archived.')
                  },
                })
              }}
            >
              Archive team
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
