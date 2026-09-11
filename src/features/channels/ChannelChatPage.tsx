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
  PushPin,
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
import { attachmentService } from '@/services/attachment.service'
import type { UploadedAttachment } from '@/services/attachment.service'
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
import { MessageSearch } from './MessageSearch'
import { ThreadPanel } from './ThreadPanel'
import { ChannelPanelColumn, ChannelPanelContent } from './ChannelPanel'
import { continuesRun, sameDay } from './grouping'
import { useMessageArrivals } from './message-arrival'

/**
 * One channel's conversation, and the primary surface of the product.
 *
 * Access is not decided here. The channel row and its messages only arrive if
 * RLS allowed them, so an inaccessible channel produces an empty result rather
 * than a hidden one — including for a guessed key in the address bar. The
 * permissions read below only decide which controls are worth drawing; every
 * one of them is checked again by the database.
 */

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
  // Which message the composer is answering. Kept here rather than inside the
  // composer so that starting, cancelling and restarting a reply never goes
  // near the draft.
  const [replyToId, setReplyToId] = useState<string | null>(null)
  // Where a jump landed, for as long as it takes to notice it.
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)

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
      void queryClient.invalidateQueries({
        queryKey: queryKeys.attachments.forMessages(channel?.id ?? 'none', messageIds.length),
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

  // Which of those have only just turned up. A view-layer reading of the array
  // the query already produced: the realtime flow is untouched, and the only
  // thing this decides is whether a bubble animates in.
  const arrivals = useMessageArrivals(messages, user?.id ?? null)

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

  const attachmentsQuery = useQuery({
    queryKey: queryKeys.attachments.forMessages(channel?.id ?? 'none', messageIds.length),
    queryFn: () => attachmentService.listFor(messageIds),
    enabled: messageIds.length > 0,
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

  // The parents of every reply on screen, in one call. Narrow rows by design:
  // a name, the words and how many files rode with them, so a quote cannot
  // carry anything else into the timeline.
  const parentIds = useMemo(
    () => [
      ...new Set(messages.map((m) => m.parentMessageId).filter((id): id is string => id !== null)),
    ],
    [messages],
  )

  const replyContextsQuery = useQuery({
    queryKey: queryKeys.messages.replyContexts(channel?.id ?? 'none', parentIds),
    queryFn: () => messageService.listReplyContexts(parentIds),
    enabled: parentIds.length > 0,
  })

  /**
   * Follow a quote back to the message it came from.
   *
   * Only within the page that is loaded: history arrives a page at a time, and
   * hunting backwards through it for one row would be a scroll nobody asked
   * for.
   */
  function jumpToMessage(id: string): void {
    const row = timelineRef.current?.querySelector(`[data-message-id="${id}"]`)
    if (!row) {
      toast.info('That message is further back in the conversation.')
      return
    }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setHighlightedId(id)
  }

  /**
   * What the composer is answering, built from the row already on screen —
   * you cannot start a reply to something you cannot see, so there is nothing
   * here to fetch.
   */
  const replyTo = useMemo(() => {
    if (replyToId === null) return null
    const target = messages.find((m) => m.id === replyToId)
    if (!target) return null
    return {
      id: target.id,
      authorName: target.authorName,
      body: target.body,
      deleted: target.deletedAt !== null,
      attachmentCount: (attachmentsQuery.data?.get(target.id) ?? []).length,
    }
  }, [replyToId, messages, attachmentsQuery.data])

  // Long enough to find the row with your eye, short enough not to become a
  // second kind of pinned message.
  useEffect(() => {
    if (highlightedId === null) return
    const timer = window.setTimeout(() => setHighlightedId(null), 1600)
    return () => window.clearTimeout(timer)
  }, [highlightedId])

  const send = useMutation({
    // Two steps, in this order: the message first, then the files against it.
    // The attachment policy asks whether the caller authored a live message
    // they may still send to, so there has to be one before there can be any.
    mutationFn: async (input: {
      body: string
      attachments: readonly UploadedAttachment[]
      parentMessageId: string | null
    }) => {
      const message = await messageService.send(
        channel?.id as string,
        input.body,
        input.parentMessageId,
      )
      if (input.attachments.length > 0) {
        await attachmentService.attach(message.id, input.attachments)
      }
    },
    onSuccess: async () => {
      realtime.clearTyping()
      // Only once it landed: a failed send keeps the reply, so the words can
      // be sent again without pointing them at their message a second time.
      setReplyToId(null)
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
      placeName={channel.name}
      placeArchived={channel.archivedAt !== null}
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
        {/* One line, 48 tall: the name, then the topic after a dot in muted.
            The hash is the only accent in the header, and it is what says
            which channel this is. */}
        <header className="border-border-subtle flex h-12 shrink-0 items-center gap-2 border-b px-4 sm:px-5">
          <Button asChild size="icon-sm" variant="ghost" className="-ml-1 md:hidden">
            <Link to="/channels" aria-label="Back to channels">
              <ArrowLeft aria-hidden="true" />
            </Link>
          </Button>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="flex min-w-0 shrink-0 items-center gap-1.5 text-[15px] leading-none font-semibold">
              {channel.isPrivate ? (
                <LockSimple className="text-accent-text size-4 shrink-0" aria-label="Private" />
              ) : (
                <Hash className="text-accent-text size-4 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{channel.name}</span>
            </h1>
            {channel.archivedAt ? <Badge variant="warning">Archived</Badge> : null}
            {channel.topic ? (
              <>
                <span
                  className="text-muted-foreground/50 hidden shrink-0 sm:inline"
                  aria-hidden="true"
                >
                  ·
                </span>
                <p className="text-muted-foreground hidden truncate text-sm sm:block">
                  {channel.topic}
                </p>
              </>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {/* What the panel holds, said in the header: a count, not a
                control. Pinning is still done from the message itself. */}
            {pinnedQuery.data && pinnedQuery.data.length > 0 ? (
              <span
                className="text-2xs text-muted-foreground mr-1 flex items-center gap-1 font-mono tabular-nums"
                aria-label={`${String(pinnedQuery.data.length)} pinned`}
              >
                <PushPin weight="fill" className="text-brass size-3" aria-hidden="true" />
                {pinnedQuery.data.length}
              </span>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setSearchOpen((open) => !open)}
                  aria-label="Search this channel"
                  aria-expanded={searchOpen}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <MagnifyingGlass aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Search messages</TooltipContent>
            </Tooltip>

            {canManage ? (
              <Button asChild size="icon-sm" variant="ghost" className="text-muted-foreground">
                <Link to="/settings/channels" aria-label="Channel settings">
                  <Gear aria-hidden="true" />
                </Link>
              </Button>
            ) : null}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={toggleDetails}
                  aria-label={detailsOpen ? 'Close panel' : 'Open panel'}
                  aria-expanded={detailsOpen}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {detailsOpen ? (
                    <CaretDoubleRight aria-hidden="true" />
                  ) : (
                    <CaretDoubleLeft aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{detailsOpen ? 'Close panel' : 'Open panel'}</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {searchOpen ? (
          <div className="min-h-0 flex-1">
            <MessageSearch
              place={{ kind: 'channel', id: channel.id, name: channel.name }}
              onClose={() => setSearchOpen(false)}
            />
          </div>
        ) : null}

        <div
          ref={timelineRef}
          className={cn('min-h-0 flex-1 overflow-y-auto', searchOpen && 'hidden')}
        >
          {/* The full width of the column, whatever the panel is doing. The
              gutter is the message row's own padding, which is also what the
              hover background fills — so the row reads as the width of the
              conversation rather than as a card floating in it.
              `justify-end` keeps a short conversation on the composer. */}
          {/* The live region is the log, not the list inside it. A reader
              is told about messages that are added without the focus moving,
              and `additions` keeps a refetch of the same fifty from being read
              out again. Deliberately here rather than on the `ul`: that
              element is the list, and a role of `log` on it would stop it
              being one. */}
          <div
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            className="flex min-h-full w-full flex-col justify-end py-4"
          >
            {messagesQuery.isPending ? (
              <div className="px-4 sm:px-5">
                <CardSkeleton lines={6} />
              </div>
            ) : messagesQuery.isError ? (
              <div className="px-4 sm:px-5">
                <ErrorState
                  error={messagesQuery.error}
                  onRetry={() => void messagesQuery.refetch()}
                />
              </div>
            ) : messages.length === 0 ? (
              <div className="px-4 sm:px-5">
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
                  const next = messages[index + 1]
                  const isMine = message.authorId === user?.id

                  return (
                    <div key={message.id} className="contents">
                      {!previous || !sameDay(previous.createdAt, message.createdAt) ? (
                        <DayDivider date={message.createdAt} />
                      ) : null}
                      <MessageRow
                        message={message}
                        grouped={continuesRun(previous, message)}
                        // The same rule, asked about the message below: the
                        // corner that faces a sibling is the only thing that
                        // reads it.
                        continuesBelow={next !== undefined && continuesRun(message, next)}
                        arrival={arrivals.arrivalOf(message.id)}
                        onSettled={() => arrivals.settle(message.id)}
                        reactions={reactionsQuery.data?.get(message.id) ?? []}
                        mentions={mentionsQuery.data?.get(message.id) ?? []}
                        attachments={attachmentsQuery.data?.get(message.id) ?? []}
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
                        replyContext={
                          message.parentMessageId === null
                            ? undefined
                            : (replyContextsQuery.data?.get(message.parentMessageId) ?? null)
                        }
                        highlighted={highlightedId === message.id}
                        // One level, which is what the database allows: a
                        // reply is not something anybody can reply to.
                        onReply={
                          message.parentMessageId === null
                            ? () => setReplyToId(message.id)
                            : undefined
                        }
                        onOpenThread={() => openThread(message.id)}
                        onJumpToParent={
                          message.parentMessageId === null
                            ? undefined
                            : () => jumpToMessage(message.parentMessageId as string)
                        }
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

        {/* The same width as the messages, and the same gutter: the composer
            carries its own padding, so its box lines up with the rows above. */}
        <div className="w-full shrink-0">
          <TypingIndicator names={typingNames} />
          <Composer
            placeName={channel.name}
            disabled={!canSend || channel.archivedAt !== null}
            disabledReason={
              channel.archivedAt !== null
                ? 'This channel is archived. Restore it from settings to post again.'
                : undefined
            }
            sending={send.isPending}
            onSend={(body, attachments) =>
              send.mutate({ body, attachments, parentMessageId: replyToId })
            }
            onTyping={realtime.noteTyping}
            mentionCandidates={mentionCandidatesQuery.data ?? []}
            replyingTo={replyTo}
            onCancelReply={() => setReplyToId(null)}
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
