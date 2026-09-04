import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Hash,
  LockSimple,
  Plus,
  Trash,
  Archive,
  ArrowCounterClockwise,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CardSkeleton, ErrorState, ForbiddenState } from '@/components/common/states'
import { channelService } from '@/services/channel.service'
import { useChannelDirectory } from '@/features/channels/use-channels'
import type { Channel } from '@/services/channel.service'
import { errorMessage } from '@/lib/errors'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { ChannelPermissionsDialog } from './ChannelPermissionsDialog'

/**
 * Channel and category management.
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

  const [newCategory, setNewCategory] = useState('')
  const [newChannel, setNewChannel] = useState('')
  const [permissionsFor, setPermissionsFor] = useState<Channel | null>(null)

  const directory = useChannelDirectory()

  async function refresh(): Promise<void> {
    await directory.invalidate()
  }

  const createCategory = useMutation({
    mutationFn: (name: string) => channelService.createCategory(organizationId as string, name),
    onSuccess: async () => {
      setNewCategory('')
      await refresh()
      toast.success('Category created.')
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  /**
   * One routine creates the channel and, when the category named above it does
   * not exist yet, the category too — in a single transaction. Creating them
   * from here as two calls would leave an empty category behind whenever the
   * channel failed, which is precisely the mess this replaces.
   */
  const createChannel = useMutation({
    mutationFn: (isPrivate: boolean) =>
      channelService.createChannelInCategory(organizationId as string, {
        name: newChannel.trim(),
        categoryName: newCategory.trim() || null,
        isPrivate,
      }),
    onSuccess: async () => {
      const category = newCategory.trim()
      setNewChannel('')
      // The category name stays put: filing several channels under one
      // section is the common case, and retyping it each time is friction.
      await refresh()
      toast.success(
        category
          ? `Channel created in ${matchingCategory?.name ?? category}.`
          : 'Channel created. It is uncategorised.',
      )
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

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

  /**
   * The category the typed name already refers to, if any. Matching is
   * case-insensitive because "Competitive" and "competitive" are one section
   * to everyone reading the sidebar — the server matches the same way, and
   * this only tells the person which of the two things is about to happen.
   */
  const matchingCategory = useMemo(() => {
    const wanted = newCategory.trim().toLowerCase()
    if (wanted === '') return null
    return directory.categories.find((c) => c.name.toLowerCase() === wanted) ?? null
  }, [newCategory, directory.categories])

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
      {canCreate || canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Add</CardTitle>
          </CardHeader>
          {/* The two fields read top to bottom as one sentence — this channel,
              in that category — because the previous layout put a button
              beside each and made them look like unrelated actions. */}
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-category">Category</Label>
              <Input
                id="new-category"
                list="existing-categories"
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="Optional — leave empty for an uncategorised channel"
                aria-label="New category name"
                autoComplete="off"
              />
              {/* Autocomplete over what already exists, so the usual way to
                  reach a category is to pick it rather than retype it. */}
              <datalist id="existing-categories">
                {directory.categories.map((category) => (
                  <option key={category.id} value={category.name} />
                ))}
              </datalist>
              <p className="text-muted-foreground text-2xs">
                {newCategory.trim() === ''
                  ? 'The channel will be uncategorised.'
                  : matchingCategory
                    ? `Goes into the existing ${matchingCategory.name}.`
                    : `Creates ${newCategory.trim()} and puts the channel in it.`}
              </p>
            </div>

            {canCreate ? (
              <div className="space-y-1.5">
                <Label htmlFor="new-channel">Channel</Label>
                <Input
                  id="new-channel"
                  value={newChannel}
                  onChange={(event) => setNewChannel(event.target.value)}
                  placeholder="New channel name"
                  aria-label="New channel name"
                  maxLength={40}
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    loading={createChannel.isPending}
                    disabled={newChannel.trim().length === 0}
                    onClick={() => createChannel.mutate(false)}
                  >
                    <Hash className="size-3.5" aria-hidden="true" />
                    Public channel
                  </Button>
                  <Button
                    variant="outline"
                    loading={createChannel.isPending}
                    disabled={newChannel.trim().length === 0}
                    onClick={() => createChannel.mutate(true)}
                  >
                    <LockSimple className="size-3.5" aria-hidden="true" />
                    Private channel
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Kept for the one case the flow above cannot express: a section
                created deliberately empty, to be filled in later. */}
            {canManage ? (
              <div className="border-border border-t pt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  loading={createCategory.isPending}
                  disabled={newCategory.trim().length === 0 || matchingCategory !== null}
                  onClick={() => createCategory.mutate(newCategory.trim())}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Category only
                </Button>
                <p className="text-muted-foreground text-2xs mt-1.5">
                  {matchingCategory
                    ? `${matchingCategory.name} already exists.`
                    : 'Creates the category above and no channel.'}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {grouped.map((group) => {
        // Bound out here: narrowing `group.category` does not survive into the
        // click handler's closure, and Uncategorised has no row to delete.
        const category = group.category

        return (
          <Card key={group.id}>
            <CardHeader className="flex-row items-center gap-2 space-y-0">
              <CardTitle className="flex-1">{group.name}</CardTitle>
              <Badge variant="outline">{group.channels.length}</Badge>
              {category && canManage ? (
                <Button
                  size="icon"
                  variant="ghost"
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
                  <Trash className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {group.channels.length === 0 ? (
                <p className="text-muted-foreground text-2xs">No channels in this category.</p>
              ) : (
                <ul className="divide-border divide-y" aria-label={`${group.name} channels`}>
                  {group.channels.map((channel) => (
                    <li key={channel.id} className="flex items-center gap-3 py-2.5">
                      {channel.isPrivate ? (
                        <LockSimple
                          className="text-muted-foreground size-3.5"
                          aria-label="Private"
                        />
                      ) : (
                        <Hash className="text-muted-foreground size-3.5" aria-hidden="true" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm leading-tight font-medium">{channel.name}</p>
                        {channel.topic ? (
                          <p className="text-2xs text-muted-foreground truncate">{channel.topic}</p>
                        ) : null}
                      </div>

                      {channel.archivedAt ? <Badge variant="warning">Archived</Badge> : null}

                      {canManagePermissions ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPermissionsFor(channel)}
                        >
                          Permissions
                        </Button>
                      ) : null}

                      {canManage ? (
                        <Button
                          size="icon"
                          variant="ghost"
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
                            <ArrowCounterClockwise className="size-3.5" aria-hidden="true" />
                          ) : (
                            <Archive className="size-3.5" aria-hidden="true" />
                          )}
                        </Button>
                      ) : null}

                      {canDelete ? (
                        <Button
                          size="icon"
                          variant="ghost"
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
                          <Trash className="size-3.5" aria-hidden="true" />
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
