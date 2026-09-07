import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DotsThree,
  PauseCircle,
  PlayCircle,
  Prohibit,
  Shield,
  UserMinus,
} from '@phosphor-icons/react'
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
import { cn } from '@/lib/utils'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { canActOnRank, canGrantRank } from '@/lib/permissions'
import { effectiveMemberStatus, suspensionEndsAt } from '@/lib/moderation'
import { ModerateMemberDialog, type ModerationIntent } from './ModerateMemberDialog'
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
  const canSuspend = usePermission('members.suspend')
  const canBan = usePermission('members.ban')
  const canUnban = usePermission('members.unban')
  const [intent, setIntent] = useState<ModerationIntent | null>(null)

  // What the member's status resolves to right now. A suspension whose
  // expiry has passed already reads as active, with nothing written.
  const effective = effectiveMemberStatus(member.status, member.suspendedUntil)
  const suspendedUntil = suspensionEndsAt(member.status, member.suspendedUntil)
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

  const removeMutation = useMutation({
    mutationFn: () => organizationService.removeMember(member.id),
    onSuccess: async () => {
      toast.success(`${displayNameFor(member.profile)} removed.`)
      await invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const busy = assignMutation.isPending || unassignMutation.isPending || removeMutation.isPending
  const showMenu = (canManage || canRemove) && mayAct && !isSelf

  // Only roles at or below the viewer's own authority may be assigned.
  const assignableRoles = roles.filter((role) => canGrantRank(actorRank, role.rank))

  // Ownership is a property of the organization, not of a role — so it is
  // only ever drawn where the app actually knows it, which is the viewer's own
  // membership. A roster row for somebody else carries no ownership claim.
  const ownsOrganization = isSelf && membership?.isOwner === true

  return (
    <div className="group/member hover:bg-surface flex min-h-14 items-center gap-3 px-3 py-2 transition-colors duration-[120ms]">
      <span className="relative shrink-0">
        <Avatar className="size-8 rounded-md">
          {member.profile.avatarUrl ? <AvatarImage src={member.profile.avatarUrl} alt="" /> : null}
          <AvatarFallback className="rounded-md">{initialsFor(member.profile)}</AvatarFallback>
        </Avatar>
        <AvatarStatus status={presence} className="size-2 border-[1.5px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              'truncate text-sm leading-tight font-semibold',
              presence === 'offline' ? 'text-secondary-foreground' : 'text-foreground',
            )}
          >
            {displayNameFor(member.profile)}
          </p>
          {isSelf ? <Badge variant="neutral">You</Badge> : null}
          {effective === 'suspended' ? (
            <Badge variant="warning">
              {suspendedUntil
                ? `Suspended until ${formatDate(suspendedUntil.toISOString())}`
                : 'Suspended'}
            </Badge>
          ) : null}
          {effective === 'banned' ? <Badge variant="destructive">Banned</Badge> : null}
        </div>
        <p className="text-2xs text-muted-foreground truncate">
          {member.profile.title ? `${member.profile.title} · ` : ''}
          <span className="font-mono">{member.profile.email}</span>
        </p>
      </div>

      {/* Presence is a dot and a word; the join date is mono, because it is a
          date and a column of them should line up. */}
      <div className="hidden w-[124px] shrink-0 text-right sm:block">
        <p className="text-2xs flex items-center justify-end gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              presence === 'online'
                ? 'bg-success'
                : presence === 'away'
                  ? 'bg-warning'
                  : 'bg-offline',
            )}
          />
          <span
            className={
              presence === 'offline' ? 'text-muted-foreground' : 'text-secondary-foreground'
            }
          >
            {presenceLabel(presence)}
          </span>
        </p>
        <p className="text-2xs text-muted-foreground truncate font-mono whitespace-nowrap">
          Joined {formatDate(member.joinedAt)}
        </p>
      </div>

      <Badge variant={ownsOrganization ? 'brass' : 'neutral'} className="shrink-0">
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
              <Badge key={role.id} variant="neutral">
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
              // Quiet until the row is under the pointer or the button has
              // focus, and never hidden from a keyboard.
              className="text-muted-foreground hover:text-foreground shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/member:opacity-100 sm:focus-visible:opacity-100 sm:aria-expanded:opacity-100"
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

            {canSuspend ? (
              <DropdownMenuItem
                onSelect={() => setIntent(effective === 'active' ? 'suspend' : 'unsuspend')}
              >
                {effective === 'active' ? (
                  <>
                    <PauseCircle aria-hidden="true" />
                    Suspend access
                  </>
                ) : (
                  <>
                    <PlayCircle aria-hidden="true" />
                    Lift suspension
                  </>
                )}
              </DropdownMenuItem>
            ) : null}

            {canBan && effective !== 'banned' ? (
              <DropdownMenuItem destructive onSelect={() => setIntent('ban')}>
                <Prohibit aria-hidden="true" />
                Ban member
              </DropdownMenuItem>
            ) : null}

            {canUnban && effective === 'banned' ? (
              <DropdownMenuItem onSelect={() => setIntent('unban')}>
                <PlayCircle aria-hidden="true" />
                Lift ban
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

      {intent && organization ? (
        <ModerateMemberDialog
          open
          onOpenChange={(next) => {
            if (!next) setIntent(null)
          }}
          member={member}
          intent={intent}
          organizationId={organization.id}
        />
      ) : null}
    </div>
  )
}
