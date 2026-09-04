import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Hash, LockSimple, Gear, MagnifyingGlass, CaretRight } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/common/PageHeader'
import { CardSkeleton, EmptyState, ErrorState, ForbiddenState } from '@/components/common/states'
import { usePermission } from '@/hooks/use-permission'
import { useChannelDirectory } from './use-channels'

/**
 * Browsing channels.
 *
 * The sidebar is where a channel is opened day to day; this page is for
 * finding one — searching by name or topic, and seeing what each section is
 * for. It is deliberately a list rather than a wall of cards: a card per
 * channel makes six channels look like a database export.
 *
 * Every channel listed came back from the database, which means the caller is
 * allowed to see it. Private channels the member has no explicit ALLOW for are
 * absent from the response, not filtered out here.
 */
export function ChannelsPage() {
  const canView = usePermission('channels.view')
  const canManage = usePermission('channels.manage')
  const directory = useChannelDirectory()
  const [search, setSearch] = useState('')

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle === '') return directory.groups

    return directory.groups
      .map((group) => ({
        ...group,
        channels: group.channels.filter(
          (channel) =>
            channel.name.toLowerCase().includes(needle) ||
            (channel.topic ?? '').toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.channels.length > 0)
  }, [directory.groups, search])

  if (!canView) return <ForbiddenState />

  const total = directory.channels.length
  const searching = search.trim() !== ''

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
      <PageHeader
        title="Channels"
        description="Every channel you can see. Pick one to open the conversation."
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

      {total > 0 ? (
        <div className="relative">
          <MagnifyingGlass
            className="text-muted-foreground/70 pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search channels"
            aria-label="Search channels"
            className="pl-8"
          />
        </div>
      ) : null}

      {directory.isPending ? (
        <CardSkeleton lines={8} />
      ) : directory.isError ? (
        <ErrorState error={directory.error} onRetry={directory.refetch} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Hash}
          title={searching ? 'Nothing matches that' : 'No channels yet'}
          description={
            searching
              ? 'Try part of a channel name or its topic.'
              : canManage
                ? 'Create your first category and channel in organization settings.'
                : 'An administrator has not set up any channels you can see.'
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.id}>
              <div className="mb-1 flex items-baseline gap-2 px-1">
                <h2 className="text-3xs text-foreground/50 font-semibold tracking-[0.1em] uppercase">
                  {group.name}
                </h2>
                <span className="text-3xs text-foreground/30 tabular-nums">
                  {group.channels.length}
                </span>
              </div>

              <ul
                className="border-border divide-border divide-y rounded-md border"
                aria-label={`${group.name} channels`}
              >
                {group.channels.map((channel) => (
                  <li key={channel.id}>
                    <Link
                      to={`/channels/${channel.key}`}
                      className="hover:bg-elevated group flex items-center gap-3 px-3 py-2.5 transition-colors duration-[140ms] first:rounded-t-md last:rounded-b-md"
                    >
                      {channel.isPrivate ? (
                        <LockSimple
                          className="text-muted-foreground size-4 shrink-0"
                          aria-label="Private channel"
                        />
                      ) : (
                        <Hash
                          className="text-muted-foreground size-4 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm leading-tight font-medium">{channel.name}</p>
                        {channel.topic ? (
                          <p className="text-2xs text-muted-foreground truncate">{channel.topic}</p>
                        ) : null}
                      </div>
                      {channel.isPrivate ? <Badge variant="secondary">Private</Badge> : null}
                      <CaretRight
                        className="text-muted-foreground/0 group-hover:text-muted-foreground/60 size-3.5 shrink-0 transition-colors"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
