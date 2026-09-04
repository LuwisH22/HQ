import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { channelService } from '@/services/channel.service'
import type { Channel, ChannelCategory } from '@/services/channel.service'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'

/**
 * The channel directory, fetched once and shared.
 *
 * The sidebar, the browse page and the settings screen all need the same two
 * lists. Each used to declare its own pair of queries, which meant three
 * places to keep in step and three chances for one of them to invalidate a key
 * the others did not use. TanStack dedupes the requests; this makes sure they
 * are asking the same question.
 *
 * Nothing here decides access. Both lists arrive already scoped by RLS, so a
 * private channel the member has no ALLOW for is simply absent.
 */

export interface ChannelGroup {
  /** null for the uncategorised group, which is not a real category row. */
  category: ChannelCategory | null
  id: string
  name: string
  channels: Channel[]
}

export interface ChannelDirectory {
  categories: ChannelCategory[]
  /** Live channels only — archived ones are reachable from settings. */
  channels: Channel[]
  /** Including archived. Settings needs these; navigation does not. */
  allChannels: Channel[]
  /** Categories in order, each with its channels; empty ones dropped. */
  groups: ChannelGroup[]
  /** Categories in order, each with its channels; empty ones kept. */
  groupsWithEmpty: ChannelGroup[]
  isPending: boolean
  isError: boolean
  error: unknown
  refetch: () => void
  /** Re-reads both lists. Every channel mutation should end with this. */
  invalidate: () => Promise<void>
}

const UNCATEGORISED = 'uncategorised'

function group(
  categories: ChannelCategory[],
  channels: Channel[],
  keepEmpty: boolean,
): ChannelGroup[] {
  const groups: ChannelGroup[] = categories.map((category) => ({
    category,
    id: category.id,
    name: category.name,
    channels: channels.filter((c) => c.categoryId === category.id),
  }))

  groups.push({
    category: null,
    id: UNCATEGORISED,
    name: 'Uncategorised',
    channels: channels.filter((c) => c.categoryId === null),
  })

  // An empty Uncategorised heading is noise; an empty real category is a
  // section somebody made on purpose and is about to fill.
  return groups.filter((g) => g.channels.length > 0 || (keepEmpty && g.category !== null))
}

export function useChannelDirectory(): ChannelDirectory {
  const { organization } = useWorkspace()
  const organizationId = organization?.id
  const canView = usePermission('channels.view')
  const queryClient = useQueryClient()

  const key = organizationId ?? 'none'
  const enabled = Boolean(organizationId) && canView

  const categoriesQuery = useQuery({
    queryKey: queryKeys.channels.categories(key),
    queryFn: () => channelService.listCategories(organizationId as string),
    enabled,
  })

  const channelsQuery = useQuery({
    queryKey: queryKeys.channels.all(key),
    queryFn: () => channelService.listChannels(organizationId as string),
    enabled,
  })

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data])
  const allChannels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data])
  const channels = useMemo(() => allChannels.filter((c) => c.archivedAt === null), [allChannels])

  const groups = useMemo(() => group(categories, channels, false), [categories, channels])
  const groupsWithEmpty = useMemo(
    () => group(categories, allChannels, true),
    [categories, allChannels],
  )

  return {
    categories,
    channels,
    allChannels,
    groups,
    groupsWithEmpty,
    // Only a query that is actually running can be pending: with no permission
    // both sit disabled forever, and a spinner that never resolves is worse
    // than an empty list.
    isPending: enabled && (categoriesQuery.isPending || channelsQuery.isPending),
    isError: categoriesQuery.isError || channelsQuery.isError,
    error: categoriesQuery.error ?? channelsQuery.error,
    refetch: () => {
      void categoriesQuery.refetch()
      void channelsQuery.refetch()
    },
    invalidate: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.channels.all(key) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.channels.categories(key) })
    },
  }
}

/** The channel a `/channels/:channelKey` route refers to, or null. */
export function useChannelByKey(channelKey: string | undefined): {
  channel: Channel | null
  directory: ChannelDirectory
} {
  const directory = useChannelDirectory()
  const channel = useMemo(
    () => directory.channels.find((c) => c.key === channelKey) ?? null,
    [directory.channels, channelKey],
  )
  return { channel, directory }
}
