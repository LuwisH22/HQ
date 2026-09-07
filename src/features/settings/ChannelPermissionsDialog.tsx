import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Info } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { channelService } from '@/services/channel.service'
import type { Channel } from '@/services/channel.service'
import type { OverrideEffect } from '@/services/service-contracts'
import { organizationService } from '@/services/organization.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'

/**
 * Per-role Allow / Deny / Inherit for one channel.
 *
 * Only four permissions can be overridden — a channel decides who may see it
 * and who may speak in it, not who may run the organization. That restriction
 * is a CHECK constraint in Postgres; this list simply matches it.
 *
 * Deny beats Allow beats Inherit, and because a member may hold several roles,
 * a single Deny anywhere is enough to shut the door.
 */
const OVERRIDABLE: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'channels.view', label: 'View channel' },
  { key: 'messages.send', label: 'Send messages' },
  { key: 'messages.pin', label: 'Pin messages' },
  { key: 'messages.moderate', label: 'Moderate messages' },
  { key: 'voice.speak', label: 'Speak in voice' },
]

const CHOICES: ReadonlyArray<{ value: OverrideEffect | null; label: string }> = [
  { value: 'allow', label: 'Allow' },
  { value: null, label: 'Inherit' },
  { value: 'deny', label: 'Deny' },
]

export function ChannelPermissionsDialog({
  open,
  onOpenChange,
  channel,
  organizationId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  channel: Channel
  organizationId: string
}) {
  const queryClient = useQueryClient()
  const { membership } = useWorkspace()
  const actorRank = membership?.isOwner ? -1 : (membership?.role.rank ?? 1000)

  const rolesQuery = useQuery({
    queryKey: queryKeys.roles.all(organizationId),
    queryFn: () => organizationService.listRoles(organizationId),
    enabled: open,
  })

  const overridesQuery = useQuery({
    queryKey: queryKeys.channels.overrides(channel.id),
    queryFn: () => channelService.listOverrides(channel.id),
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: (input: { roleId: string; permissionKey: string; effect: OverrideEffect | null }) =>
      channelService.setOverride(channel.id, input.roleId, input.permissionKey, input.effect),
    onSuccess: async () => {
      // Never optimistic: who can see a channel is not something to render
      // before the database has agreed to it.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.channels.overrides(channel.id),
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.channels.all(organizationId) })
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  function current(roleId: string, permissionKey: string): OverrideEffect | null {
    const row = (overridesQuery.data ?? []).find(
      (o) => o.roleId === roleId && o.permissionKey === permissionKey,
    )
    return row?.effect ?? null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-3 flex max-h-[88dvh] translate-y-0 flex-col gap-0 overflow-hidden overflow-y-hidden p-0 sm:top-1/2 sm:max-h-[85dvh] sm:max-w-2xl sm:-translate-y-1/2">
        <div className="border-border-subtle shrink-0 border-b px-5 py-4">
          <DialogTitle>Permissions · {channel.name}</DialogTitle>
          <DialogDescription className="mt-1">
            {channel.isPrivate
              ? 'This channel is private: nobody sees it without an explicit Allow.'
              : 'This channel inherits organization permissions unless overridden here.'}
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {(rolesQuery.data ?? [])
            // You may only change access for roles below your own authority;
            // Postgres refuses the rest anyway.
            .filter((role) => role.rank > actorRank)
            .map((role) => (
              <div key={role.id}>
                <p className="display-eyebrow text-3xs text-muted-foreground mb-2">{role.name}</p>
                <div className="divide-border-subtle divide-y">
                  {OVERRIDABLE.map((permission) => {
                    const value = current(role.id, permission.key)
                    return (
                      <div key={permission.key} className="flex min-h-9 items-center gap-3 py-1.5">
                        <span className="text-secondary-foreground min-w-0 flex-1 text-xs">
                          {permission.label}
                        </span>
                        {/* One control with three segments rather than three
                            chips: the choices are exclusive, and a segmented
                            control says so by its shape before its colour. */}
                        <div
                          className="border-border bg-elevated flex shrink-0 overflow-hidden rounded-sm border"
                          role="group"
                          aria-label={`${permission.label} for ${role.name}`}
                        >
                          {CHOICES.map((choice, index) => (
                            <button
                              key={choice.label}
                              type="button"
                              aria-pressed={value === choice.value}
                              disabled={mutation.isPending}
                              onClick={() =>
                                mutation.mutate({
                                  roleId: role.id,
                                  permissionKey: permission.key,
                                  effect: choice.value,
                                })
                              }
                              className={cn(
                                'text-2xs border-border h-6 px-2 transition-colors duration-[120ms]',
                                index > 0 && 'border-l',
                                value === choice.value
                                  ? choice.value === 'deny'
                                    ? 'bg-destructive/12 text-destructive font-medium'
                                    : 'bg-surface-active text-accent-text font-medium'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                              )}
                            >
                              {choice.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
        </div>

        <div className="border-border-subtle bg-elevated flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          <p className="text-muted-foreground text-2xs flex items-center gap-1.5">
            <Info className="size-3.5 shrink-0" aria-hidden="true" />
            Deny wins over Allow. Roles above your own are not listed.
          </p>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
