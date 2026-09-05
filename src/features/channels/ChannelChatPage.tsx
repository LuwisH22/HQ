import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CaretDoubleLeft,
  CaretDoubleRight,
  Gear,
  Hash,
  LockSimple,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CardSkeleton, EmptyState, ErrorState, ForbiddenState } from '@/components/common/states'
import { channelService } from '@/services/channel.service'
import { messageService } from '@/services/message.service'
import type { Message } from '@/services/message.service'
import { organizationService } from '@/services/organization.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/hooks/use-auth'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { useIsDesktop } from '@/hooks/use-media-query'
import { useUiStore } from '@/stores/ui.store'
import { cn } from '@/lib/utils'
import { useChannelByKey } from './use-channels'
import { useChannelRealtime } from './use-channel-realtime'
import { TypingIndicator } from './TypingIndicator'
import { MessageRow, DayDivider } from './MessageRow'
import { Composer } from './Composer'
import { ChannelSearch } from './ChannelSearch'
import { ThreadPanel } from './ThreadPanel'
import { ChannelPanelColumn, ChannelPanelContent } from './ChannelPanel'

/**
 * One channel's conversation, and the primary surface of the product.
 *
 * Access is not decided here. The channel row and its messages only arrive if
 * RLS allowed them, so an inaccessible channel produces an empty result rather
 * than a hidden one — including for a guessed key in the address bar. The
 * permissions read below only decide which controls are worth drawing; every
 * one of them is checked again by the database.
 */

/** A run of messages is one person talking if it is close enough in time. */
const GROUPING_WINDOW_MS = 5 * 60_000

function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function continues(previous: Message | undefined, message: Message): boolean {
  if (!previous) return false
  if (previous.authorId !== message.authorId) return false
  if (previous.deletedAt !== null || message.deletedAt !== null) return false
  // A pinned message is being singled out; folding it into the run above
  // would hide the very thing that was pinned.
  if (message.pinnedAt !== null) return false
  if (!sameDay(previous.createdAt, message.createdAt)) return false
  return (
    new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
    GROUPING_WINDOW_MS
  )
}

export function ChannelChatPage() {
  const { channelKey } = useParams<{ channelKey: string }>()
  const { organization } = useWorkspace()
  const { user } = useAuth()
  const organizationId = organization?.id
  const canView = usePermission('channels.view')
  const canSend = usePermission('messages.send')
  const canModerate = usePermission('messages.moderate')
  const canPin = usePermission('messages.pin')
  const canManage = usePermission('channels.manage')
  const queryClient = useQueryClient()

  const { channel, directory } = useChannelByKey(channelKey)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // A column on a wide screen and a sheet on a phone are two different
  // controls: the column's state is remembered, the sheet's is not, and one
  // flag describing both would be wrong for one of them.
  const isDesktop = useIsDesktop()
  const panelOpen = useUiStore((state) => state.channelPanelOpen)
  const setPanelOpen = useUiStore((state) => state.setChannelPanelOpen)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // Which thread the panel is showing, if any. The panel has a mode; there
  // is no fourth column.
  const [threadRootId, setThreadRootId] = useState<string | null>(null)

  const detailsOpen = isDesktop ? panelOpen : sheetOpen
  const toggleDetails = () => (isDesktop ? setPanelOpen(!panelOpen) : setSheetOpen((open) => !open))

  function openThread(rootId: string): void {
    setThreadRootId(rootId)
    // A thread that opened into a collapsed panel would look like nothing
    // happened at all.
    if (isDesktop) setPanelOpen(true)
    else setSheetOpen(true)
  }

  const messagesQuery = useQuery({
    queryKey: queryKeys.messages.list(channel?.id ?? 'none'),
    queryFn: () => messageService.list(channel?.id as string),
    enabled: Boolean(channel),
  })

  // The roster is what turns a typing user id into a name. Loading it here
  // means a broadcast payload never has to carry one.
  const membersQuery = useQuery({
    queryKey: queryKeys.members.all(organizationId ?? 'none'),
    queryFn: () => organizationService.listMembers(organizationId as string),
    enabled: Boolean(organizationId),
  })

  const invalidateMessages = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.messages.list(channel?.id ?? 'none') })

  const realtime = useChannelRealtime(
    channel?.id ?? null,
    user?.id ?? null,
    () => {
      void invalidateMessages()
      // Pinning is an UPDATE on the message, so it arrives on this same event.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messages.pinned(channel?.id ?? 'none'),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messages.mentions(channel?.id ?? 'none'),
      })
    },
    () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messages.reactions(channel?.id ?? 'none'),
      })
    },
  )

  // Resolved in Postgres through the same rules that govern the channel, so a
  // private channel lists the people actually allowed into it rather than the
  // whole organization.
  const channelMemberIdsQuery = useQuery({
    queryKey: queryKeys.channelMembers.forChannel(channel?.id ?? 'none'),
    queryFn: () => channelService.listChannelMembers(channel?.id as string),
    enabled: Boolean(channel),
  })

  const channelMembers = useMemo(() => {
    const allowed = new Set(channelMemberIdsQuery.data ?? [])
    return (membersQuery.data ?? []).filter((m) => allowed.has(m.userId))
  }, [membersQuery.data, channelMemberIdsQuery.data])

  const typingNames = useMemo(() => {
    const byUser = new Map((membersQuery.data ?? []).map((m) => [m.userId, m.profile]))
    return (
      realtime.typingUserIds
        // Someone the roster does not recognise is dropped rather than
        // rendered: a spoofed id cannot put an arbitrary label on screen.
        .map((id) => byUser.get(id))
        .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
        .map((profile) => profile.displayName ?? profile.fullName ?? profile.email)
    )
  }, [realtime.typingUserIds, membersQuery.data])

  const messages = useMemo(() => messagesQuery.data?.messages ?? [], [messagesQuery.data])

  const messageIds = useMemo(() => messages.map((m) => m.id), [messages])

  const reactionsQuery = useQuery({
    queryKey: [...queryKeys.messages.reactions(channel?.id ?? 'none'), messageIds.length],
    queryFn: () => messageService.listReactions(messageIds),
    enabled: messageIds.length > 0,
  })

  const mentionsQuery = useQuery({
    queryKey: [...queryKeys.messages.mentions(channel?.id ?? 'none'), messageIds.length],
    queryFn: () => messageService.listMentions(messageIds),
    enabled: messageIds.length > 0,
  })

  // Only people this channel would actually deliver a mention to. A private
  // channel must not become a way to enumerate the organization.
  const mentionCandidatesQuery = useQuery({
    queryKey: queryKeys.channelMembers.mentionable(channel?.id ?? 'none'),
    queryFn: () => channelService.listMentionCandidates(channel?.id as string),
    enabled: Boolean(channel),
    staleTime: 5 * 60_000,
  })

  const pinnedQuery = useQuery({
    queryKey: queryKeys.messages.pinned(channel?.id ?? 'none'),
    queryFn: () => messageService.listPinned(channel?.id as string),
    enabled: Boolean(channel),
  })

  const invalidateReactions = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.messages.reactions(channel?.id ?? 'none'),
    })

  const react = useMutation({
    mutationFn: (input: { id: string; emoji: string }) =>
      messageService.addReaction(input.id, input.emoji),
    onSuccess: () => invalidateReactions(),
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const unreact = useMutation({
    mutationFn: (input: { id: string; emoji: string }) =>
      messageService.removeReaction(input.id, input.emoji),
    onSuccess: () => invalidateReactions(),
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  // Opening a channel is what marks it read. Fired on arrival and again
  // whenever new messages land while it is on screen, so the badge does not
  // reappear behind the reader's back.
  useEffect(() => {
    if (!channel || !organizationId) return
    void channelService.markRead(channel.id).then(
      () => queryClient.invalidateQueries({ queryKey: queryKeys.reads.unread(organizationId) }),
      () => undefined,
    )
  }, [channel, organizationId, messages.length, queryClient])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, channel?.id])

  const send = useMutation({
    mutationFn: (body: string) => messageService.send(channel?.id as string, body),
    onSuccess: async () => {
      realtime.clearTyping()
      await invalidateMessages()
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const saveEdit = useMutation({
    mutationFn: (input: { id: string; body: string }) => messageService.edit(input.id, input.body),
    onSuccess: () => invalidateMessages(),
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => messageService.remove(id),
    onSuccess: () => invalidateMessages(),
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const pin = useMutation({
    mutationFn: (input: { id: string; pinned: boolean }) =>
      messageService.setPinned(input.id, input.pinned),
    onSuccess: () => invalidateMessages(),
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  if (!canView) return <ForbiddenState />

  if (directory.isPending) {
    return (
      <div className="p-4 sm:p-6">
        <CardSkeleton lines={8} />
      </div>
    )
  }

  if (!channel) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          icon={Hash}
          title="Channel not found"
          description="It may have been deleted or archived, or you may not have access to it."
        />
      </div>
    )
  }

  const threadRoot = threadRootId ? (messages.find((m) => m.id === threadRootId) ?? null) : null

  const panel = threadRoot ? (
    <ThreadPanel
      root={threadRoot}
      channelName={channel.name}
      channelArchived={channel.archivedAt !== null}
      onClose={() => setThreadRootId(null)}
    />
  ) : (
    <ChannelPanelContent
      channel={channel}
      members={channelMembers}
      membersPending={membersQuery.isPending || channelMemberIdsQuery.isPending}
      pinned={pinnedQuery.data ?? []}
      pinnedPending={pinnedQuery.isPending}
    />
  )

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Two lines, not one: the topic is what the channel is for, and
            squeezing it beside the name meant it was usually truncated away. */}
        <header className="border-border bg-surface/40 flex shrink-0 items-center gap-3 border-b px-4 py-2.5 sm:px-6">
          <Button asChild size="icon-sm" variant="ghost" className="-ml-1 md:hidden">
            <Link to="/channels" aria-label="Back to channels">
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
          </Button>

          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 text-sm leading-tight font-semibold">
              {channel.isPrivate ? (
                <LockSimple
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-label="Private"
                />
              ) : (
                <Hash className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{channel.name}</span>
              {channel.archivedAt ? <Badge variant="warning">Archived</Badge> : null}
            </h1>
            {channel.topic ? (
              <p className="text-2xs text-muted-foreground mt-0.5 truncate">{channel.topic}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setSearchOpen((open) => !open)}
                  aria-label="Search this channel"
                  aria-expanded={searchOpen}
                  className="text-muted-foreground hover:text-foreground size-8"
                >
                  <MagnifyingGlass className="size-[18px]" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Search messages</TooltipContent>
            </Tooltip>

            {canManage ? (
              <Button asChild size="icon" variant="ghost" className="text-muted-foreground size-8">
                <Link to="/settings/channels" aria-label="Channel settings">
                  <Gear className="size-[18px]" aria-hidden="true" />
                </Link>
              </Button>
            ) : null}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={toggleDetails}
                  aria-label={detailsOpen ? 'Close panel' : 'Open panel'}
                  aria-expanded={detailsOpen}
                  className="text-muted-foreground hover:text-foreground size-8"
                >
                  {detailsOpen ? (
                    <CaretDoubleRight className="size-[18px]" aria-hidden="true" />
                  ) : (
                    <CaretDoubleLeft className="size-[18px]" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{detailsOpen ? 'Close panel' : 'Open panel'}</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {searchOpen ? (
          <div className="min-h-0 flex-1">
            <ChannelSearch
              channelId={channel.id}
              channelName={channel.name}
              onClose={() => setSearchOpen(false)}
            />
          </div>
        ) : null}

        <div className={cn('min-h-0 flex-1 overflow-y-auto', searchOpen && 'hidden')}>
          {/* Centred and bounded in both states, so closing the panel widens
              the conversation rather than stranding it against the left edge.
              `justify-end` keeps a short conversation on the composer. */}
          <div className="mx-auto flex min-h-full w-full max-w-[1000px] flex-col justify-end px-2 py-4 sm:px-4">
            {messagesQuery.isPending ? (
              <div className="px-4">
                <CardSkeleton lines={6} />
              </div>
            ) : messagesQuery.isError ? (
              <div className="px-4">
                <ErrorState
                  error={messagesQuery.error}
                  onRetry={() => void messagesQuery.refetch()}
                />
              </div>
            ) : messages.length === 0 ? (
              <div className="px-4">
                <EmptyState
                  icon={channel.isPrivate ? LockSimple : Hash}
                  title="No messages yet"
                  description={`This is the beginning of #${channel.name}.`}
                  className="border-0"
                />
              </div>
            ) : (
              <ul aria-label="Messages">
                {messages.map((message, index) => {
                  const previous = messages[index - 1]
                  const isMine = message.authorId === user?.id

                  return (
                    <div key={message.id} className="contents">
                      {!previous || !sameDay(previous.createdAt, message.createdAt) ? (
                        <DayDivider date={message.createdAt} />
                      ) : null}
                      <MessageRow
                        message={message}
                        grouped={continues(previous, message)}
                        reactions={reactionsQuery.data?.get(message.id) ?? []}
                        mentions={mentionsQuery.data?.get(message.id) ?? []}
                        currentUserId={user?.id ?? null}
                        actions={{
                          // Editing belongs to the author. Moderation confers
                          // removal, never rewriting somebody else's words.
                          canEdit: isMine,
                          canPin,
                          canDelete: isMine || canModerate,
                          // Reacting is speaking in the channel, so it rides on
                          // the same permission as sending.
                          canReact: canSend && channel.archivedAt === null,
                        }}
                        onReply={() => openThread(message.id)}
                        onReact={(emoji) => react.mutate({ id: message.id, emoji })}
                        onUnreact={(emoji) => unreact.mutate({ id: message.id, emoji })}
                        onEdit={(body) => saveEdit.mutate({ id: message.id, body })}
                        onTogglePin={() =>
                          pin.mutate({ id: message.id, pinned: message.pinnedAt === null })
                        }
                        onDelete={() => {
                          if (window.confirm('Delete this message?')) remove.mutate(message.id)
                        }}
                      />
                    </div>
                  )
                })}
              </ul>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1000px] shrink-0 px-2 sm:px-4">
          <TypingIndicator names={typingNames} />
          <Composer
            channelName={channel.name}
            disabled={!canSend || channel.archivedAt !== null}
            disabledReason={
              channel.archivedAt !== null
                ? 'This channel is archived. Restore it from settings to post again.'
                : undefined
            }
            sending={send.isPending}
            onSend={(body) => send.mutate(body)}
            onTyping={realtime.noteTyping}
            mentionCandidates={mentionCandidatesQuery.data ?? []}
          />
        </div>
      </div>

      {/* One of the two, never both: rendering the column hidden on a phone
          left a second copy of every member and every heading in the DOM. */}
      {isDesktop ? (
        <ChannelPanelColumn open={panelOpen}>{panel}</ChannelPanelColumn>
      ) : (
        /* A phone has no room for a permanent second column, so the same panel
           arrives as a sheet from the same control. */
        <DialogPrimitive.Root open={sheetOpen} onOpenChange={setSheetOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 fixed inset-0 z-50 bg-black/70 md:hidden" />
            <DialogPrimitive.Content
              className={cn(
                'border-border bg-surface fixed inset-y-0 right-0 z-50 flex w-80 max-w-[85vw] flex-col border-l',
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
                'duration-[240ms] md:hidden',
              )}
            >
              <VisuallyHidden>
                <DialogPrimitive.Title>Channel details</DialogPrimitive.Title>
              </VisuallyHidden>
              <DialogPrimitive.Close asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close panel"
                  className="text-muted-foreground absolute top-3 right-3 z-10"
                >
                  <X aria-hidden="true" />
                </Button>
              </DialogPrimitive.Close>
              {panel}
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </div>
  )
}
