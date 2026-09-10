import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormFailure } from '@/components/common/FormFailure'
import { organizationService } from '@/services/organization.service'
import { displayNameFor, initialsFor } from '@/services/profile.service'
import type { TeamMember } from '@/services/team.service'
import { queryKeys } from '@/lib/query-keys'
import { handleOf, rosterCandidates } from './roster-candidates'
import type { useTeamMutations } from './use-teams'

/**
 * Putting somebody on a roster.
 *
 * The candidates are this organization's own members and nothing else: the
 * same list Members draws, read under the caller's own JWT, so there is no
 * second directory to keep in step and nobody from another organization can
 * appear — the policy would not return them.
 *
 * Somebody already on the roster is not offered, and neither is anybody
 * suspended or banned. Both because the routine would refuse them, and because
 * offering an action that is going to fail is a worse interface than not
 * offering it.
 *
 * A search box for six people looks like overkill until the organization has
 * thirty; it filters what is already loaded and asks the database nothing.
 */
export function AddMemberDialog({
  organizationId,
  teamName,
  roster,
  open,
  onOpenChange,
  mutations,
}: {
  organizationId: string
  teamName: string
  roster: readonly TeamMember[]
  open: boolean
  onOpenChange: (open: boolean) => void
  mutations: ReturnType<typeof useTeamMutations>
}) {
  const [search, setSearch] = useState('')
  const { addMember } = mutations

  useEffect(() => {
    if (open) {
      setSearch('')
      addMember.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const members = useQuery({
    queryKey: queryKeys.members.all(organizationId),
    queryFn: () => organizationService.listMembers(organizationId),
    enabled: open,
    staleTime: 60_000,
  })

  const candidates = rosterCandidates(members.data ?? [], roster, search)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (addMember.isPending) return
        onOpenChange(next)
      }}
    >
      <DialogContent aria-describedby={undefined} className="flex max-h-[80dvh] flex-col sm:max-w-sm">
        <div className="shrink-0 px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">Add to {teamName}</DialogTitle>
          <DialogDescription className="mt-1">
            Anybody in this organization who is not already on the roster.
          </DialogDescription>
        </div>

        <div className="border-border-subtle shrink-0 border-y px-5 py-3">
          <div className="relative">
            <MagnifyingGlass
              aria-hidden="true"
              className="text-muted-foreground/60 pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            />
            <Input
              aria-label="Search members"
              placeholder="Search by name"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
              }}
              className="pl-8"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {members.isPending ? (
            <p className="text-muted-foreground/70 px-3 py-2 text-xs">Loading…</p>
          ) : candidates.length === 0 ? (
            <p className="text-muted-foreground/70 px-3 py-2 text-xs">
              {search.trim()
                ? 'Nobody by that name.'
                : 'Everybody in this organization is already on this team.'}
            </p>
          ) : (
            <ul>
              {candidates.map((member) => (
                <li key={member.id}>
                  <button
                    type="button"
                    // The row reads as a name and a handle; the action it
                    // performs is said out loud for anybody who cannot see
                    // that it is a button in an "Add to …" dialog.
                    aria-label={`Add ${displayNameFor(member.profile)} to ${teamName}`}
                    disabled={addMember.isPending}
                    onClick={() => {
                      addMember.mutate(member.id, {
                        onSuccess: () => {
                          toast.success(`${displayNameFor(member.profile)} added to the roster.`)
                        },
                      })
                    }}
                    className="hover:bg-elevated focus-visible:ring-ring flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                  >
                    <Avatar className="size-6 shrink-0">
                      <AvatarImage src={member.profile.avatarUrl ?? undefined} alt="" />
                      <AvatarFallback className="text-[9px]">
                        {initialsFor(member.profile)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {displayNameFor(member.profile)}
                      </span>
                      <span className="text-3xs text-muted-foreground block truncate font-mono">
                        {handleOf(member.profile.email)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-border-subtle shrink-0 space-y-3 border-t px-5 py-3">
          <FormFailure error={addMember.isError ? addMember.error : null} />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              disabled={addMember.isPending}
              onClick={() => {
                onOpenChange(false)
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
