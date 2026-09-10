import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/common/FormField'
import { FormFailure } from '@/components/common/FormFailure'
import type { TeamMember } from '@/services/team.service'
import { displayNameFor } from '@/services/profile.service'
import type { RosterStatus } from '@/types/database.types'
import { ROSTER_STATUS_LABELS, ROSTER_STATUSES } from './roster-status'
import type { useTeamMutations } from './use-teams'

/**
 * What somebody does on a team, and whether they are starting.
 *
 * Two operational fields and nothing else. There is no organization role here,
 * no permission, no account status and no ownership — `update_team_member`
 * takes none of them, writes two columns on one roster row, and would refuse
 * anything else if a form invented it.
 *
 * The position is free text on purpose: "Duelist", "IGL", "Head coach" and
 * "Analyst" are not a list anybody can write down in advance, and an
 * enumeration would be a thing to maintain for no gain.
 */
export function EditRosterMemberDialog({
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
  const { updateMember } = mutations
  const [position, setPosition] = useState('')
  const [status, setStatus] = useState<RosterStatus>('active')

  // Filled when it opens, and only then: a refetch arriving while somebody is
  // typing must not discard what they typed. Keyed on the member rather than
  // on their row's contents for the same reason 7.2's edit dialog had to be —
  // an effect that reacts to the write it caused is a race.
  useEffect(() => {
    if (!member) return
    setPosition(member.position ?? '')
    setStatus(member.status)
    updateMember.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.memberId])

  const name = member ? displayNameFor(member.profile) : ''
  const trimmed = position.trim()
  const changed =
    member !== null && (trimmed !== (member.position ?? '') || status !== member.status)

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(next) => {
        if (updateMember.isPending) return
        onOpenChange(next)
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">{name ? `${name} on ${teamName}` : 'Roster'}</DialogTitle>
          <DialogDescription className="mt-1">
            What they do on this team, and whether they are playing. This changes nothing about
            their account or what they can do in LFG HQ.
          </DialogDescription>
        </div>

        <div className="space-y-4 px-5 py-4">
          <FormField label="Position" hint="Optional. Whatever this organization calls it.">
            {(props) => (
              <Input
                {...props}
                value={position}
                maxLength={40}
                placeholder="Duelist, IGL, Analyst…"
                onChange={(event) => {
                  setPosition(event.target.value)
                }}
              />
            )}
          </FormField>

          <FormField label="Status">
            {(props) => (
              <Select
                value={status}
                onValueChange={(next) => {
                  setStatus(next as RosterStatus)
                }}
              >
                <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROSTER_STATUSES.map((one) => (
                    <SelectItem key={one} value={one}>
                      {ROSTER_STATUS_LABELS[one]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormFailure error={updateMember.isError ? updateMember.error : null} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={updateMember.isPending}
              onClick={() => {
                onOpenChange(false)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={updateMember.isPending}
              disabled={!changed}
              onClick={() => {
                if (!member) return
                updateMember.mutate(
                  {
                    memberId: member.memberId,
                    // An emptied field means "take it off", which the service
                    // turns into the routine's own flag rather than a guess.
                    patch: { position: trimmed || null, status },
                  },
                  {
                    onSuccess: () => {
                      onOpenChange(false)
                      toast.success('Roster updated.')
                    },
                  },
                )
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
