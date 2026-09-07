import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Hash, LockSimple, Trash, Archive, ArrowCounterClockwise } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CardSkeleton, ErrorState, ForbiddenState } from '@/components/common/states'
import { channelService } from '@/services/channel.service'
import { useChannelDirectory } from '@/features/channels/use-channels'
import type { Channel } from '@/services/channel.service'
import { errorMessage } from '@/lib/errors'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { ChannelPermissionsDialog } from './ChannelPermissionsDialog'

/**
 * Channel and category administration.
 *
 * Editing, not creating. A channel is made from the + beside Channels in the
 * sidebar, where the channels already are — coming to Settings to start a
 * conversation was a detour through an administration screen, and it is the
 * everyday action of the two.
 *
 * Everything here is a thin wrapper over a guarded routine: the database
 * re-checks the permission and the hierarchy for each action, so hiding a
 * button is a courtesy rather than the control. Nothing is optimistic —
 * a channel's visibility is not something to render before the server agrees.
 */
export function ChannelsSettings() {
  const { organization } = useWorkspace()
  const organizationId = organization?.id

  const canView = usePermission('channels.view')
  const canCreate = usePermission('channels.create')
  const canManage = usePermission('channels.manage')
  const canDelete = usePermission('channels.delete')
  const canManagePermissions = usePermission('channels.permissions_manage')

  const [permissionsFor, setPermissionsFor] = useState<Channel | null>(null)

  const directory = useChannelDirectory()

  async function refresh(): Promise<void> {
    await directory.invalidate()
  }

  const archive = useMutation({
    mutationFn: (input: { id: string; archived: boolean }) =>
      channelService.updateChannel(input.id, { archived: input.archived }),
    onSuccess: async (_data, input) => {
      await refresh()
      toast.success(input.archived ? 'Channel archived.' : 'Channel restored.')
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => channelService.deleteChannel(id),
    onSuccess: async () => {
      await refresh()
      toast.success('Channel deleted.')
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const removeCategory = useMutation({
    mutationFn: (id: string) => channelService.deleteCategory(id),
    onSuccess: async () => {
      await refresh()
      toast.success('Category deleted. Its channels are now uncategorised.')
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const grouped = directory.groupsWithEmpty

  if (!canView) return <ForbiddenState />

  if (directory.isPending) {
    return (
      <Card>
        <CardContent className="pt-4">
          <CardSkeleton lines={8} />
        </CardContent>
      </Card>
    )
  }

  if (directory.isError) {
    return <ErrorState error={directory.error} onRetry={directory.refetch} />
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Channels</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {canCreate
            ? 'Rename, move, archive and set permissions here. New channels are created with + beside Channels in the sidebar.'
            : 'Every channel you can see, and what each one is for.'}
        </p>
      </div>

      {grouped.map((group) => {
        // Bound out here: narrowing `group.category` does not survive into the
        // click handler's closure, and Uncategorised has no row to delete.
        const category = group.category

        return (
          <Card key={group.id}>
            <CardHeader className="border-border-subtle flex-row items-center gap-2 space-y-0 border-b">
              <CardTitle className="display-eyebrow text-3xs text-muted-foreground flex-1">
                {group.name}
              </CardTitle>
              <span className="text-2xs text-muted-foreground font-mono tabular-nums">
                {group.channels.length}
              </span>
              {category && canManage ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive -my-1"
                  aria-label={`Delete category ${category.name}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete the category "${category.name}"? Its channels are kept and become uncategorised.`,
                      )
                    ) {
                      removeCategory.mutate(category.id)
                    }
                  }}
                >
                  <Trash aria-hidden="true" />
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="pt-2">
              {group.channels.length === 0 ? (
                <p className="text-muted-foreground text-2xs py-1">No channels in this category.</p>
              ) : (
                <ul
                  className="divide-border-subtle -mx-2 divide-y"
                  aria-label={`${group.name} channels`}
                >
                  {group.channels.map((channel) => (
                    <li key={channel.id} className="flex min-h-11 items-center gap-2.5 px-2 py-1.5">
                      {/* The sidebar's channel language, unchanged: one icon
                          per kind, one size, one weight. */}
                      {channel.isPrivate ? (
                        <LockSimple
                          className="text-muted-foreground size-4 shrink-0"
                          aria-label="Private"
                        />
                      ) : (
                        <Hash
                          className="text-muted-foreground size-4 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm leading-tight font-semibold">
                          {channel.name}
                        </p>
                        {channel.topic ? (
                          <p className="text-2xs text-muted-foreground truncate">{channel.topic}</p>
                        ) : null}
                      </div>

                      {channel.archivedAt ? <Badge variant="warning">Archived</Badge> : null}
                      <span className="text-2xs text-muted-foreground hidden shrink-0 font-mono sm:inline">
                        {channel.isPrivate ? 'private' : 'public'}
                      </span>

                      {canManagePermissions ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          onClick={() => setPermissionsFor(channel)}
                        >
                          Permissions
                        </Button>
                      ) : null}

                      {canManage ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          aria-label={
                            channel.archivedAt
                              ? `Restore ${channel.name}`
                              : `Archive ${channel.name}`
                          }
                          onClick={() =>
                            archive.mutate({ id: channel.id, archived: !channel.archivedAt })
                          }
                        >
                          {channel.archivedAt ? (
                            <ArrowCounterClockwise aria-hidden="true" />
                          ) : (
                            <Archive aria-hidden="true" />
                          )}
                        </Button>
                      ) : null}

                      {canDelete ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          aria-label={`Delete ${channel.name}`}
                          onClick={() => {
                            // Permanent, and it will take the message history with
                            // it once Phase 2 lands. Archiving is the reversible
                            // option and is one button to the left.
                            if (
                              window.confirm(
                                `Permanently delete #${channel.name}? This cannot be undone — archiving is reversible.`,
                              )
                            ) {
                              remove.mutate(channel.id)
                            }
                          }}
                        >
                          <Trash aria-hidden="true" />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )
      })}

      {permissionsFor && organizationId ? (
        <ChannelPermissionsDialog
          open
          onOpenChange={(next) => {
            if (!next) setPermissionsFor(null)
          }}
          channel={permissionsFor}
          organizationId={organizationId}
        />
      ) : null}
    </div>
  )
}
