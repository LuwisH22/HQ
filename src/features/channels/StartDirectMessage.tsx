import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { conversationService } from '@/services/conversation.service'
import { organizationService } from '@/services/organization.service'
import { initialsFor } from '@/services/profile.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/hooks/use-auth'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'

/**
 * Starting a direct message, from where the direct messages already are.
 *
 * The roster it offers is the organization's, filtered to people who can
 * actually be messaged — yourself excluded, because a conversation with
 * yourself is not one, and suspended or banned members excluded, because
 * start_direct_message refuses them and offering a name that will be refused
 * is worse than not offering it.
 *
 * Pressing the same name twice is safe: the routine is idempotent, so it
 * returns the conversation that already exists rather than making a second
 * one. That is a property of the unique index in the database, not of this
 * component being careful.
 */
export function StartDirectMessage({ onNavigate }: { onNavigate?: () => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { organization } = useWorkspace()
  const { user } = useAuth()
  const organizationId = organization?.id

  useEffect(() => {
    if (open) setSearch('')
  }, [open])

  const membersQuery = useQuery({
    queryKey: queryKeys.members.all(organizationId ?? 'none'),
    queryFn: () => organizationService.listMembers(organizationId as string),
    enabled: Boolean(organizationId) && open,
  })

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (membersQuery.data ?? [])
      .filter((member) => member.userId !== user?.id && member.status === 'active')
      .filter((member) => {
        if (needle === '') return true
        const name = member.profile.displayName ?? member.profile.fullName ?? member.profile.email
        return name.toLowerCase().includes(needle)
      })
  }, [membersQuery.data, search, user?.id])

  const start = useMutation({
    mutationFn: (userId: string) =>
      conversationService.startDirect(organizationId as string, userId),
    onSuccess: async (conversationId) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all(organizationId ?? 'none'),
      })
      setOpen(false)
      onNavigate?.()
      void navigate(`/dm/${conversationId}`)
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  if (!organizationId) return null

  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-muted-foreground hover:text-foreground size-5"
        aria-label="Start a direct message"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>Start a direct message</DialogTitle>
          <DialogDescription>
            Pick somebody in the organization. Opening a conversation you already have simply takes
            you back to it.
          </DialogDescription>

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search members"
            aria-label="Search members"
            autoFocus
          />

          {membersQuery.isPending ? (
            <div className="space-y-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-muted h-10 rounded-sm" />
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-muted-foreground text-2xs px-1 py-4 text-center">
              {membersQuery.data?.length === 1
                ? 'There is nobody else in the organization yet.'
                : 'Nobody matches that.'}
            </p>
          ) : (
            <ul className="max-h-72 space-y-px overflow-y-auto" aria-label="Members">
              {candidates.map((member) => {
                const name =
                  member.profile.displayName ?? member.profile.fullName ?? member.profile.email
                return (
                  <li key={member.userId}>
                    <button
                      type="button"
                      disabled={start.isPending}
                      // Read aloud, the initials in the avatar are the name
                      // again with the letters removed.
                      aria-label={`${name}, ${member.role.name}`}
                      data-member-name={name}
                      onClick={() => start.mutate(member.userId)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors',
                        'hover:bg-accent focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                        'disabled:opacity-45',
                      )}
                    >
                      <Avatar className="size-7 shrink-0" aria-hidden="true">
                        {member.profile.avatarUrl ? (
                          <AvatarImage src={member.profile.avatarUrl} alt="" />
                        ) : null}
                        <AvatarFallback>{initialsFor(member.profile)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm leading-tight font-medium">
                          {name}
                        </span>
                        <span className="text-2xs text-muted-foreground block truncate">
                          {member.role.name}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
