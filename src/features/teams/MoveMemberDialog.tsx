import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
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
import type { Team, TeamMember } from '@/services/team.service'
import { displayNameFor } from '@/services/profile.service'
import type { useTeamMutations } from './use-teams'

/**
 * Moving somebody to another side.
 *
 * One operation rather than a removal followed by an addition: doing it as two
 * calls would leave somebody on both teams, or on neither, the moment the
 * second one failed. What they do and whether they were starting goes with
 * them, because a duelist moved to the academy is still a duelist.
 *
 * Only teams they could actually be moved to are offered — this organization's
 * own, not archived, and not the one they are already on. A team they are
 * already on would be refused by the routine, so it is not in the list.
 */
export function MoveMemberDialog({
  member,
  team,
  teams,
  onOpenChange,
  mutations,
}: {
  member: TeamMember | null
  /** The team they are on now. */
  team: Team
  /** Every team in the organization, as the list already loaded them. */
  teams: readonly Team[]
  onOpenChange: (open: boolean) => void
  mutations: ReturnType<typeof useTeamMutations>
}) {
  const { moveMember } = mutations
  const [target, setTarget] = useState('')

  const destinations = teams.filter(
    (one) => one.id !== team.id && one.archivedAt === null,
  )

  useEffect(() => {
    if (!member) return
    setTarget('')
    moveMember.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.memberId])

  const name = member ? displayNameFor(member.profile) : ''

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(next) => {
        if (moveMember.isPending) return
        onOpenChange(next)
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">{name ? `Move ${name}` : 'Move member'}</DialogTitle>
          <DialogDescription className="mt-1">
            They come off this roster and go onto the other one, keeping their position and status.
          </DialogDescription>
        </div>

        <div className="border-border-subtle bg-background text-2xs text-muted-foreground border-y px-5 py-3">
          <span className="inline-flex items-center gap-2 font-mono">
            <span className="text-foreground">{team.name}</span>
            <ArrowRight aria-hidden="true" className="size-3 shrink-0" />
            <span className={target ? 'text-foreground' : ''}>
              {target ? (destinations.find((one) => one.id === target)?.name ?? '') : 'a team'}
            </span>
          </span>
        </div>

        <div className="space-y-3 px-5 py-4">
          {destinations.length === 0 ? (
            <p className="text-muted-foreground/70 text-xs">
              There is nowhere to move them: this organization has no other active team.
            </p>
          ) : (
            <FormField label="Move to">
              {(props) => (
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                    <SelectValue placeholder="Pick a team" />
                  </SelectTrigger>
                  <SelectContent>
                    {destinations.map((one) => (
                      <SelectItem key={one.id} value={one.id}>
                        {one.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}

          <FormFailure error={moveMember.isError ? moveMember.error : null} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={moveMember.isPending}
              onClick={() => {
                onOpenChange(false)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={moveMember.isPending}
              disabled={target === ''}
              onClick={() => {
                if (!member || target === '') return
                moveMember.mutate(
                  { memberId: member.memberId, toTeamId: target },
                  {
                    onSuccess: () => {
                      onOpenChange(false)
                      toast.success(`${name} moved.`)
                    },
                  },
                )
              }}
            >
              Move
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
