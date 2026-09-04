import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DotsThree, PauseCircle, PlayCircle, Shield, UserMinus } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage, AvatarStatus } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  organizationService,
  type MemberRole,
  type OrganizationMember,
} from '@/services/organization.service'
import { displayNameFor, initialsFor } from '@/services/profile.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { canActOnRank, canGrantRank } from '@/lib/permissions'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { presenceFrom, presenceLabel } from '@/utils/presence'
import { formatDate } from '@/utils/datetime'

/**
 * One member, with the actions the viewer is actually allowed to take.
 *
 * Availability is decided by three things at once: the viewer's permissions,
 * their rank relative to the target, and the last-owner rule. All three are
 * re-checked by the `organization_members` guard trigger, so the worst a stale
 * UI can do is offer an action the server then refuses with a clear message.
 */
export function MemberRow({ member, roles }: { member: OrganizationMember; roles: MemberRole[] }) {
  const queryClient = useQueryClient()
  const { membership, organization } = useWorkspace()
  const canManage = usePermission('members.manage')
  const canRemove = usePermission('members.remove')

  // The owner outranks every possible role; otherwise authority is the most
  // authoritative role held. Mirrors my_role_rank() in Postgres.
  const actorRank = membership?.isOwner ? -1 : membership?.role.rank
  const isSelf = membership?.membershipId === member.id
  const mayAct = canActOnRank(actorRank, member.role.rank, { isSelf })
  const presence = presenceFrom(member.profile.lastSeenAt)

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.members.all(organization?.id ?? 'none'),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.audit.recent(organization?.id ?? 'none', 12),
      }),
    ])
  }

  const assignMutation = useMutation({
    mutationFn: (roleId: string) => organizationService.assignRole(member.id, roleId),
    onSuccess: async () => {
      toast.success(`${displayNameFor(member.profile)} role added.`)
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const unassignMutation = useMutation({
    mutationFn: (roleId: string) => organizationService.unassignRole(member.id, roleId),
    onSuccess: async () => {
      toast.success(`${displayNameFor(member.profile)} role removed.`)
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const statusMutation = useMutation({
    mutationFn: (status: 'active' | 'suspended') =>
      organizationService.updateMemberStatus(member.id, status),
    onSuccess: async (_data, status) => {
      toast.success(status === 'suspended' ? 'Member suspended.' : 'Member reactivated.')
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const removeMutation = useMutation({
    mutationFn: () => organizationService.removeMember(member.id),
    onSuccess: async () => {
      toast.success(`${displayNameFor(member.profile)} removed.`)
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const busy = assignMutation.isPending || unassignMutation.isPending || statusMutation.isPending || removeMutation.isPending
  const showMenu = (canManage || canRemove) && mayAct && !isSelf

  // Only roles at or below the viewer's own authority may be assigned.
  const assignableRoles = roles.filter((role) => canGrantRank(actorRank, role.rank))

  return (
    <div className="bg-card flex items-center gap-3 rounded-md p-3 shadow-sm">
      <span className="relative shrink-0">
        <Avatar className="size-9">
          {member.profile.avatarUrl ? <AvatarImage src={member.profile.avatarUrl} alt="" /> : null}
          <AvatarFallback>{initialsFor(member.profile)}</AvatarFallback>
        </Avatar>
        <AvatarStatus status={presence} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm leading-tight font-medium">
            {displayNameFor(member.profile)}
          </p>
          {isSelf ? <Badge variant="secondary">You</Badge> : null}
          {member.status === 'suspended' ? <Badge variant="warning">Suspended</Badge> : null}
        </div>
        <p className="text-2xs text-muted-foreground truncate">
          {member.profile.title ? `${member.profile.title} · ` : ''}
          {member.profile.email}
        </p>
      </div>

      <div className="hidden shrink-0 text-right sm:block">
        <p className="text-2xs text-muted-foreground">{presenceLabel(presence)}</p>
        <p className="text-2xs text-muted-foreground/70">Joined {formatDate(member.joinedAt)}</p>
      </div>

      <Badge variant={member.role.rank === 0 ? 'default' : 'outline'} className="shrink-0">
        <Shield className="size-3" aria-hidden="true" />
        {member.role.name}
      </Badge>

      {/* Additional roles. The primary badge above is only the most
          authoritative one; permissions are the union of them all. */}
      {member.roles.length > 1 ? (
        <span className="hidden shrink-0 gap-1 sm:flex">
          {member.roles
            .filter((role) => role.id !== member.role.id)
            .map((role) => (
              <Badge key={role.id} variant="secondary">
                {role.name}
              </Badge>
            ))}
        </span>
      ) : null}

      {showMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              loading={busy}
              aria-label={`Actions for ${displayNameFor(member.profile)}`}
            >
              {busy ? null : <DotsThree aria-hidden="true" />}
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-52">
            {canManage && assignableRoles.length > 0 ? (
              <>
                <DropdownMenuLabel>Roles</DropdownMenuLabel>
                {/* A member may hold several roles; their permissions are the
                    union. Unchecking the last one is refused by the database,
                    so the final held role is not offered as removable. */}
                {assignableRoles.map((role) => {
                  const held = member.roles.some((r) => r.id === role.id)
                  const isLastHeld = held && member.roles.length === 1
                  return (
                    <DropdownMenuCheckboxItem
                      key={role.id}
                      checked={held}
                      disabled={isLastHeld}
                      onCheckedChange={(next: boolean) => {
                        if (next && !held) assignMutation.mutate(role.id)
                        else if (!next && held && !isLastHeld) unassignMutation.mutate(role.id)
                      }}
                    >
                      {role.name}
                    </DropdownMenuCheckboxItem>
                  )
                })}
                <DropdownMenuSeparator />
              </>
            ) : null}

            {canManage ? (
              <DropdownMenuItem
                onSelect={() =>
                  statusMutation.mutate(member.status === 'active' ? 'suspended' : 'active')
                }
              >
                {member.status === 'active' ? (
                  <>
                    <PauseCircle aria-hidden="true" />
                    Suspend access
                  </>
                ) : (
                  <>
                    <PlayCircle aria-hidden="true" />
                    Restore access
                  </>
                )}
              </DropdownMenuItem>
            ) : null}

            {canRemove ? (
              <DropdownMenuItem
                destructive
                onSelect={() => {
                  const name = displayNameFor(member.profile)
                  if (window.confirm(`Remove ${name} from the organization?`)) {
                    removeMutation.mutate()
                  }
                }}
              >
                <UserMinus aria-hidden="true" />
                Remove from organization
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="w-8 shrink-0" aria-hidden="true" />
      )}
    </div>
  )
}
