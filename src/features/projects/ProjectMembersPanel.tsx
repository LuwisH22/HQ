import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, X } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { organizationService } from '@/services/organization.service'
import { projectService, type Project } from '@/services/project.service'
import { displayNameFor, initialsFor } from '@/services/profile.service'
import { effectiveMemberStatus } from '@/lib/moderation'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/use-permission'
import { useProjectMembers } from './use-projects'

/**
 * Who a project is for.
 *
 * Context rather than access: nobody on this list can read anything they could
 * not read anyway, and taking somebody off does not take anything away from
 * them. It says who the work belongs to, which is what assigning it will need.
 *
 * The picker is the organization's own roster, filtered to people not already
 * here — there is no second directory to keep in step, and somebody suspended
 * or banned is not offered, because the routine would refuse them anyway.
 */
export function ProjectMembersPanel({
  project,
  layout = 'column',
}: {
  project: Project
  /** `row` is the compact strip the project header uses above the board. */
  layout?: 'column' | 'row'
}) {
  const queryClient = useQueryClient()
  const canManage = usePermission('projects.manage')
  const canViewMembers = usePermission('members.view')

  const members = useProjectMembers(project.organizationId, project.id)

  const roster = useQuery({
    queryKey: queryKeys.members.all(project.organizationId),
    queryFn: () => organizationService.listMembers(project.organizationId),
    enabled: canManage && canViewMembers,
    staleTime: 60_000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(project.organizationId) })

  const add = useMutation({
    mutationFn: (memberId: string) => projectService.addMember(project.id, memberId),
    onSuccess: async () => {
      await invalidate()
    },
    onError: (error) => {
      toast.error(errorMessage(error))
    },
  })

  const remove = useMutation({
    mutationFn: (memberId: string) => projectService.removeMember(project.id, memberId),
    onSuccess: async () => {
      await invalidate()
    },
    onError: (error) => {
      toast.error(errorMessage(error))
    },
  })

  const onProject = new Set((members.data ?? []).map((member) => member.memberId))
  const available = (roster.data ?? []).filter(
    (member) =>
      !onProject.has(member.id) &&
      effectiveMemberStatus(member.status, member.suspendedUntil) === 'active',
  )

  const row = layout === 'row'

  return (
    <section
      aria-labelledby="project-members"
      className={row ? 'flex flex-wrap items-center gap-2' : 'space-y-2'}
    >
      <div className={row ? 'flex items-center gap-2' : 'flex items-center gap-2'}>
        <h2
          id="project-members"
          className={cn('display-eyebrow text-3xs text-muted-foreground', row ? '' : 'flex-1')}
        >
          Members
        </h2>

        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-2xs h-6">
                <Plus aria-hidden="true" />
                Add
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Add somebody</DropdownMenuLabel>
              {available.length === 0 ? (
                <p className="text-muted-foreground/70 px-2 py-2 text-xs">
                  Everybody is already on this project.
                </p>
              ) : (
                available.map((member) => (
                  <DropdownMenuItem
                    key={member.id}
                    onSelect={() => {
                      add.mutate(member.id)
                    }}
                  >
                    {displayNameFor(member.profile)}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {members.data && members.data.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nobody is on this project yet.</p>
      ) : null}

      <ul className={row ? 'flex flex-wrap items-center gap-1.5' : 'space-y-1'}>
        {(members.data ?? []).map((member) => (
          <li
            key={member.memberId}
            className={cn(
              'border-border-subtle bg-surface flex items-center gap-2.5 rounded-sm border',
              row ? 'py-1 pr-1 pl-1.5' : 'px-2.5 py-2',
            )}
          >
            <Avatar className="size-6 shrink-0">
              <AvatarImage src={member.profile.avatarUrl ?? undefined} alt="" />
              <AvatarFallback>{initialsFor(member.profile)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate text-xs">
              {displayNameFor(member.profile)}
            </span>
            {canManage ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground size-6"
                aria-label={`Remove ${displayNameFor(member.profile)}`}
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(member.memberId)
                }}
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
