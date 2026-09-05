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

  const send = useMutation({
    mutationFn: (body: string) => messageService.sendToConversation(conversationId as string, body),
    onSuccess: async () => {
      realtime.clearTyping()
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

        <div className={cn('min-h-0 flex-1 overflow-y-auto', searchOpen && 'hidden')}>
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

        <div className="w-full shrink-0">
          <TypingIndicator names={typingNames} />
          <Composer
            placeName={name}
            placeKind="conversation"
            disabled={false}
            sending={send.isPending}
            onSend={(body) => send.mutate(body)}
            onTyping={realtime.noteTyping}
            mentionCandidates={mentionCandidatesQuery.data ?? []}
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
