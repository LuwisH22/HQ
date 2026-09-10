import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormFailure } from '@/components/common/FormFailure'
import type { TeamMember } from '@/services/team.service'
import { displayNameFor } from '@/services/profile.service'
import type { useTeamMutations } from './use-teams'

/**
 * Taking somebody off a roster.
 *
 * The wording matters more than usual here. Removing a person from a team and
 * removing them from the organization are two entirely different things, and
 * only one of them is happening — so the dialog says the other one is not,
 * rather than leaving somebody to infer it from a red button.
 *
 * It is also true underneath: `remove_team_member` deletes one roster row and
 * touches nothing else. Their membership, roles and permissions are exactly
 * what they were a second earlier.
 */
export function RemoveMemberDialog({
  member,
  teamName,
  onOpenChange,
  mutations,
}: {
  member: TeamMember | null
  teamName: string
  onOpenChange: (open: boolean) => void
  mutations: ReturnType<typeof useTeamMutations>
}) {
  const { removeMember } = mutations
  const name = member ? displayNameFor(member.profile) : ''

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(next) => {
        if (removeMember.isPending) return
        removeMember.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">
            {member ? `Remove ${name} from ${teamName}?` : 'Remove from team?'}
          </DialogTitle>
          <DialogDescription className="mt-1">
            This takes them off the roster. It does not remove them from LFG HQ, and changes
            nothing about what they can do here.
          </DialogDescription>
        </div>

        <div className="space-y-3 px-5 py-4">
          <FormFailure error={removeMember.isError ? removeMember.error : null} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={removeMember.isPending}
              onClick={() => {
                onOpenChange(false)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={removeMember.isPending}
              onClick={() => {
                if (!member) return
                removeMember.mutate(member.memberId, {
                  onSuccess: () => {
                    onOpenChange(false)
                    toast.success(`${name} removed from the roster.`)
                  },
                })
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
