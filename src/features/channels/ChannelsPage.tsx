import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Hash, LockSimple, Gear } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/common/PageHeader'
import { CardSkeleton, EmptyState, ErrorState, ForbiddenState } from '@/components/common/states'
import { channelService } from '@/services/channel.service'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'

/**
 * The channel directory.
 *
 * Every channel listed here came back from the database, which means the
 * caller is allowed to see it — private channels the member has no explicit
 * Allow for are absent from the response, not filtered out afterwards. There
 * is nothing to hide client-side and nothing to guess.
 *
 * Reading and writing messages is Phase 2; this is the structure they will
 * hang from.
 */
export function ChannelsPage() {
  const { organization } = useWorkspace()
  const organizationId = organization?.id
  const canView = usePermission('channels.view')
  const canManage = usePermission('channels.manage')

  const categoriesQuery = useQuery({
    queryKey: ['channel-categories', organizationId ?? 'none'],
    queryFn: () => channelService.listCategories(organizationId as string),
    enabled: Boolean(organizationId) && canView,
  })

  const channelsQuery = useQuery({
    queryKey: ['channels', organizationId ?? 'none'],
    queryFn: () => channelService.listChannels(organizationId as string),
    enabled: Boolean(organizationId) && canView,
  })

  const grouped = useMemo(() => {
    const categories = categoriesQuery.data ?? []
    // Archived channels stay out of the directory; they are still reachable
    // from settings, where they can be restored.
    const channels = (channelsQuery.data ?? []).filter((c) => c.archivedAt === null)

    return [
      ...categories.map((category) => ({
        id: category.id,
        name: category.name,
        channels: channels.filter((c) => c.categoryId === category.id),
      })),
      { id: 'uncategorised', name: 'Uncategorised', channels: channels.filter((c) => !c.categoryId) },
    ].filter((group) => group.channels.length > 0)
  }, [categoriesQuery.data, channelsQuery.data])

  if (!canView) return <ForbiddenState />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Channels"
        description="Where the organization talks. Messaging arrives in Phase 2."
        actions={
          canManage ? (
            <Button asChild size="sm" variant="outline">
              <Link to="/settings/channels">
                <Gear className="size-3.5" aria-hidden="true" />
                Manage
              </Link>
            </Button>
          ) : null
        }
      />

      {categoriesQuery.isPending || channelsQuery.isPending ? (
        <Card>
          <CardContent className="pt-4">
            <CardSkeleton lines={8} />
          </CardContent>
        </Card>
      ) : categoriesQuery.isError || channelsQuery.isError ? (
        <ErrorState
          error={categoriesQuery.error ?? channelsQuery.error}
          onRetry={() => {
            void categoriesQuery.refetch()
            void channelsQuery.refetch()
          }}
        />
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={Hash}
          title="No channels yet"
          description={
            canManage
              ? 'Create your first category and channel in organization settings.'
              : 'An administrator has not set up any channels you can see.'
          }
        />
      ) : (
        grouped.map((group) => (
          <Card key={group.id}>
            <CardHeader className="flex-row items-center gap-2 space-y-0">
              <CardTitle className="flex-1">{group.name}</CardTitle>
              <Badge variant="outline">{group.channels.length}</Badge>
            </CardHeader>
            <CardContent>
              <ul className="divide-border divide-y" aria-label={`${group.name} channels`}>
                {group.channels.map((channel) => (
                  <li key={channel.id} className="flex items-center gap-3 py-2.5">
                    {channel.isPrivate ? (
                      <LockSimple
                        className="text-muted-foreground size-3.5 shrink-0"
                        aria-label="Private channel"
                      />
                    ) : (
                      <Hash className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm leading-tight font-medium">{channel.name}</p>
                      {channel.topic ? (
                        <p className="text-2xs text-muted-foreground truncate">{channel.topic}</p>
                      ) : null}
                    </div>
                    {channel.isPrivate ? <Badge variant="secondary">Private</Badge> : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
