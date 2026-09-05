import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CaretDoubleLeft,
  CaretDoubleRight,
  ChatTeardropText,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CardSkeleton, EmptyState, ErrorState } from '@/components/common/states'
import { conversationService } from '@/services/conversation.service'
import { messageService } from '@/services/message.service'
import { attachmentService } from '@/services/attachment.service'
import type { UploadedAttachment } from '@/services/attachment.service'
import type { Message } from '@/services/message.service'
import { organizationService } from '@/services/organization.service'
import { initialsFor } from '@/services/profile.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/hooks/use-auth'
import { useWorkspace } from '@/hooks/use-workspace'
import { useIsDesktop } from '@/hooks/use-media-query'
import { useUiStore } from '@/stores/ui.store'
import { cn } from '@/lib/utils'
import { useConversation } from './use-conversations'
import { useConversationRealtime } from './use-conversation-realtime'
import { TypingIndicator } from './TypingIndicator'
import { MessageRow, DayDivider } from './MessageRow'
import { Composer } from './Composer'
import { MessageSearch } from './MessageSearch'
import { ThreadPanel } from './ThreadPanel'
import { ChannelPanelColumn } from './ChannelPanel'
import { ConversationPanelContent } from './ConversationPanel'
import { continuesRun, sameDay } from './grouping'

/**
 * One direct conversation.
 *
 * Every primitive on screen is the channel one: the same MessageRow, the same
 * Composer with the same mention menu, the same thread panel, the same search.
 * What differs is which place the messages come from and who is allowed in —
 * and "who is allowed in" is not decided here at all. The conversation and its
 * messages arrive only if RLS allowed them, so a conversation the member is not
 * in produces nothing, including for a guessed id in the address bar and
 * including for the organization's owner.
 *
 * There are no permissions to read. Inside a conversation there is nothing to
 * hold: being in it is the whole of it, moderation does not reach into one, and
 * either person may pin.
 */
export function ConversationChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const { organization } = useWorkspace()
  const { user } = useAuth()
  const organizationId = organization?.id
  const queryClient = useQueryClient()

  const { conversation, query: conversationsQuery } = useConversation(conversationId)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const isDesktop = useIsDesktop()
  const panelOpen = useUiStore((state) => state.channelPanelOpen)
  const setPanelOpen = useUiStore((state) => state.setChannelPanelOpen)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
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
    if (isDesktop) setPanelOpen(true)
    else setSheetOpen(true)
  }

  const messagesQuery = useQuery({
    queryKey: queryKeys.messages.list(conversationId ?? 'none'),
    queryFn: () => messageService.listConversation(conversationId as string),
    enabled: Boolean(conversation),
  })

  // The roster turns a typing user id into a name, so a broadcast payload
  // never has to carry one.
  const membersQuery = useQuery({
    queryKey: queryKeys.members.all(organizationId ?? 'none'),
    queryFn: () => organizationService.listMembers(organizationId as string),
    enabled: Boolean(organizationId),
  })

  const invalidateMessages = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.messages.list(conversationId ?? 'none') })

  const realtime = useConversationRealtime(
    conversation ? (conversationId ?? null) : null,
    user?.id ?? null,
    () => {
      void invalidateMessages()
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messages.pinned(conversationId ?? 'none'),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messages.mentions(conversationId ?? 'none'),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.attachments.forMessages(conversationId ?? 'none', messageIds.length),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all(organizationId ?? 'none'),
      })
    },
    () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messages.reactions(conversationId ?? 'none'),
      })
    },
  )

  const typingNames = useMemo(() => {
    const byUser = new Map((membersQuery.data ?? []).map((m) => [m.userId, m.profile]))
    return (
      realtime.typingUserIds
        // Somebody the roster does not recognise is dropped rather than
        // rendered: a spoofed id cannot put an arbitrary label on screen.
        .map((id) => byUser.get(id))
        .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
        .map((profile) => profile.displayName ?? profile.fullName ?? profile.email)
    )
  }, [realtime.typingUserIds, membersQuery.data])

  const messages = useMemo(() => messagesQuery.data?.messages ?? [], [messagesQuery.data])
  const messageIds = useMemo(() => messages.map((m) => m.id), [messages])

  const reactionsQuery = useQuery({
    queryKey: [...queryKeys.messages.reactions(conversationId ?? 'none'), messageIds.length],
    queryFn: () => messageService.listReactions(messageIds),
    enabled: messageIds.length > 0,
  })

  const mentionsQuery = useQuery({
    queryKey: [...queryKeys.messages.mentions(conversationId ?? 'none'), messageIds.length],
    queryFn: () => messageService.listMentions(messageIds),
    enabled: messageIds.length > 0,
  })

  // The people in the conversation, never channel_member_ids: a DM has no
  // channel, and its roster is exactly who is in it.
  const mentionCandidatesQuery = useQuery({
    queryKey: queryKeys.channelMembers.mentionable(conversationId ?? 'none'),
    queryFn: () => conversationService.listMentionCandidates(conversationId as string),
    enabled: Boolean(conversation),
    staleTime: 5 * 60_000,
  })

  const attachmentsQuery = useQuery({
    queryKey: queryKeys.attachments.forMessages(conversationId ?? 'none', messageIds.length),
    queryFn: () => attachmentService.listFor(messageIds),
    enabled: messageIds.length > 0,
  })

  const pinnedQuery = useQuery({
    queryKey: queryKeys.messages.pinned(conversationId ?? 'none'),
    queryFn: () => messageService.listConversationPinned(conversationId as string),
    enabled: Boolean(conversation),
  })

  const invalidateReactions = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.messages.reactions(conversationId ?? 'none'),
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

  // Opening a conversation is what marks it read. Fired on arrival and again
  // whenever new messages land while it is on screen, so the badge does not
  // reappear behind the reader's back.
  useEffect(() => {
    if (!conversation || !organizationId) return
    void conversationService.markRead(conversation.id).then(
      () =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.all(organizationId),
        }),
      () => undefined,
    )
  }, [conversation, organizationId, messages.length, queryClient])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, conversationId])

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
    queryKey: queryKeys.messages.replyContexts(conversationId ?? 'none', parentIds),
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
      const message = await messageService.sendToConversation(
        conversationId as string,
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
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all(organizationId ?? 'none'),
      })
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

  if (conversationsQuery.isPending) {
    return (
      <div className="p-4 sm:p-6">
        <CardSkeleton lines={8} />
      </div>
    )
  }

  if (conversationsQuery.isError) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          error={conversationsQuery.error}
          onRetry={() => void conversationsQuery.refetch()}
        />
      </div>
    )
  }

  if (!conversation) {
    // Absent rather than forbidden, and the same page either way: a
    // conversation you are not in must be indistinguishable from one that does
    // not exist.
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          icon={ChatTeardropText}
          title="Conversation not found"
          description="It may not exist, or you may not be part of it."
        />
      </div>
    )
  }

  const name = conversation.otherName
  const threadRoot = threadRootId ? (messages.find((m) => m.id === threadRootId) ?? null) : null

  const panel = threadRoot ? (
    <ThreadPanel
      root={threadRoot}
      placeName={name}
      placeArchived={false}
      onClose={() => setThreadRootId(null)}
    />
  ) : (
    <ConversationPanelContent
      conversation={conversation}
      pinned={pinnedQuery.data ?? []}
      pinnedPending={pinnedQuery.isPending}
    />
  )

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-surface/40 flex shrink-0 items-center gap-3 border-b px-4 py-2.5 sm:px-6">
          <Button asChild size="icon-sm" variant="ghost" className="-ml-1 md:hidden">
            <Link to="/channels" aria-label="Back to channels">
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
          </Button>

          <Avatar className="size-7 shrink-0">
            {conversation.otherAvatarUrl ? (
              <AvatarImage src={conversation.otherAvatarUrl} alt="" />
            ) : null}
            <AvatarFallback>{initialsFor({ displayName: name })}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm leading-tight font-semibold">{name}</h1>
            <p className="text-2xs text-muted-foreground mt-0.5 truncate">Direct message</p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setSearchOpen((open) => !open)}
                  aria-label="Search this conversation"
                  aria-expanded={searchOpen}
                  className="text-muted-foreground hover:text-foreground size-8"
                >
                  <MagnifyingGlass className="size-[18px]" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Search messages</TooltipContent>
            </Tooltip>

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
            <MessageSearch
              place={{ kind: 'conversation', id: conversation.id, name }}
              onClose={() => setSearchOpen(false)}
            />
          </div>
        ) : null}

        <div
          ref={timelineRef}
          className={cn('min-h-0 flex-1 overflow-y-auto', searchOpen && 'hidden')}
        >
          {/* The full width of the column; the gutter is the message row's
              own padding. See ChannelChatPage. */}
          <div className="flex min-h-full w-full flex-col justify-end py-4">
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
                  icon={ChatTeardropText}
                  title="No messages yet"
                  description={`This is the beginning of your conversation with ${name}.`}
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
                        grouped={continuesRun(previous, message)}
                        reactions={reactionsQuery.data?.get(message.id) ?? []}
                        mentions={mentionsQuery.data?.get(message.id) ?? []}
                        attachments={attachmentsQuery.data?.get(message.id) ?? []}
                        currentUserId={user?.id ?? null}
                        actions={{
                          canEdit: isMine,
                          // Either person may keep something at the top; there
                          // is no permission inside a conversation to hold.
                          canPin: true,
                          // And no moderation: only the author may remove.
                          canDelete: isMine,
                          canReact: true,
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

        <div className="w-full shrink-0">
          <TypingIndicator names={typingNames} />
          <Composer
            placeName={name}
            placeKind="conversation"
            disabled={false}
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

      {isDesktop ? (
        <ChannelPanelColumn open={panelOpen}>{panel}</ChannelPanelColumn>
      ) : (
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
                <DialogPrimitive.Title>Conversation details</DialogPrimitive.Title>
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

export type { Message }
