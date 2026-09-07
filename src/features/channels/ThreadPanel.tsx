import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { CardSkeleton, ErrorState } from '@/components/common/states'
import { channelService } from '@/services/channel.service'
import { conversationService } from '@/services/conversation.service'
import { messageService } from '@/services/message.service'
import type { Message } from '@/services/message.service'
import { attachmentService } from '@/services/attachment.service'
import type { UploadedAttachment } from '@/services/attachment.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/hooks/use-auth'
import { usePermission } from '@/hooks/use-permission'
import { MessageRow } from './MessageRow'
import { Composer } from './Composer'

/**
 * One thread, in the panel the channel details already occupy.
 *
 * No fourth column: the panel has a mode. Everything about a reply is
 * governed by the rules that govern the channel it sits in — the same policy
 * decided the root — so nothing here re-decides access.
 */
export function ThreadPanel({
  root,
  placeName,
  placeArchived,
  onClose,
}: {
  root: Message
  /** The channel's name, or the other person's in a direct message. */
  placeName: string
  placeArchived: boolean
  onClose: () => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const canSendInChannel = usePermission('messages.send')
  const canModerateChannel = usePermission('messages.moderate')
  const canPinInChannel = usePermission('messages.pin')

  // A thread lives exactly where its root lives, so this is the one place the
  // panel has to ask which kind of place that is. Ids are uuids from disjoint
  // tables, so one query namespace serves both.
  const inConversation = root.conversationId !== null
  const placeId = root.channelId ?? root.conversationId ?? 'none'

  // In a conversation there are no permissions to hold: being in it is the
  // whole of it, and moderation is a channel power that does not reach inside
  // somebody else's correspondence.
  const canSend = inConversation ? true : canSendInChannel
  const canModerate = inConversation ? false : canModerateChannel
  const canPin = inConversation ? true : canPinInChannel

  const repliesQuery = useQuery({
    queryKey: queryKeys.messages.replies(root.id),
    queryFn: () => messageService.listReplies(root.id),
  })

  const replies = repliesQuery.data ?? []
  const ids = [root.id, ...replies.map((r) => r.id)]

  const mentionsQuery = useQuery({
    queryKey: [...queryKeys.messages.mentions(placeId), 'thread', root.id, ids.length],
    queryFn: () => messageService.listMentions(ids),
  })

  const mentionCandidatesQuery = useQuery({
    queryKey: queryKeys.channelMembers.mentionable(placeId),
    // A conversation's roster is the people in it, never channel_member_ids.
    queryFn: () =>
      inConversation
        ? conversationService.listMentionCandidates(placeId)
        : channelService.listMentionCandidates(placeId),
    staleTime: 5 * 60_000,
  })

  const reactionsQuery = useQuery({
    queryKey: [...queryKeys.messages.reactions(placeId), 'thread', root.id, ids.length],
    queryFn: () => messageService.listReactions(ids),
  })

  const attachmentsQuery = useQuery({
    queryKey: [...queryKeys.attachments.forMessages(placeId, ids.length), 'thread', root.id],
    queryFn: () => attachmentService.listFor(ids),
  })

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: queryKeys.messages.replies(root.id) })
    await queryClient.invalidateQueries({
      queryKey: queryKeys.messages.mentions(placeId),
    })
    // The root's reply count lives on the message itself, so the timeline is
    // stale as soon as a reply lands.
    await queryClient.invalidateQueries({ queryKey: queryKeys.messages.list(placeId) })
    await attachmentsQuery.refetch()
  }

  const reply = useMutation({
    // The reply first, then its files: the attachment policy asks whether the
    // caller authored a live message they may still send to.
    mutationFn: async (input: { body: string; attachments: readonly UploadedAttachment[] }) => {
      const message = inConversation
        ? await messageService.sendToConversation(placeId, input.body, root.id)
        : await messageService.send(placeId, input.body, root.id)
      if (input.attachments.length > 0) {
        await attachmentService.attach(message.id, input.attachments)
      }
    },
    onSuccess: refresh,
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const saveEdit = useMutation({
    mutationFn: (input: { id: string; body: string }) => messageService.edit(input.id, input.body),
    onSuccess: refresh,
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => messageService.remove(id),
    onSuccess: refresh,
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const pin = useMutation({
    mutationFn: (input: { id: string; pinned: boolean }) =>
      messageService.setPinned(input.id, input.pinned),
    onSuccess: refresh,
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const react = useMutation({
    mutationFn: (input: { id: string; emoji: string }) =>
      messageService.addReaction(input.id, input.emoji),
    onSuccess: () => reactionsQuery.refetch(),
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const unreact = useMutation({
    mutationFn: (input: { id: string; emoji: string }) =>
      messageService.removeReaction(input.id, input.emoji),
    onSuccess: () => reactionsQuery.refetch(),
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  // A thread whose root is gone keeps its replies but takes no new ones.
  const rootAlive = root.deletedAt === null
  const canReply = canSend && !placeArchived && rootAlive

  function actionsFor(message: Message) {
    return {
      canEdit: message.authorId === user?.id,
      canPin,
      canDelete: message.authorId === user?.id || canModerate,
      canReact: canSend && !placeArchived,
    }
  }

  function rowHandlers(message: Message) {
    return {
      onEdit: (body: string) => saveEdit.mutate({ id: message.id, body }),
      onTogglePin: () => pin.mutate({ id: message.id, pinned: message.pinnedAt === null }),
      onDelete: () => {
        if (window.confirm('Delete this message?')) remove.mutate(message.id)
      },
      onReact: (emoji: string) => react.mutate({ id: message.id, emoji }),
      onUnreact: (emoji: string) => unreact.mutate({ id: message.id, emoji }),
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border-subtle flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground -ml-1"
          aria-label="Back to channel details"
          onClick={onClose}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div className="min-w-0">
          <h2 className="display-eyebrow text-3xs text-muted-foreground">Thread</h2>
          <p className="text-2xs text-secondary-foreground truncate font-mono">
            {inConversation ? placeName : `#${placeName}`}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <ul aria-label="Thread">
          <MessageRow
            message={root}
            grouped={false}
            reactions={reactionsQuery.data?.get(root.id) ?? []}
            mentions={mentionsQuery.data?.get(root.id) ?? []}
            attachments={attachmentsQuery.data?.get(root.id) ?? []}
            currentUserId={user?.id ?? null}
            actions={actionsFor(root)}
            {...rowHandlers(root)}
          />
        </ul>

        <div className="mx-2 flex items-center gap-2 px-2 py-3" aria-hidden="true">
          <span className="border-border-subtle flex-1 border-t" />
          <span className="text-2xs text-muted-foreground font-mono">
            {replies.length === 0
              ? 'No replies yet'
              : `${String(replies.length)} ${replies.length === 1 ? 'reply' : 'replies'}`}
          </span>
          <span className="border-border-subtle flex-1 border-t" />
        </div>

        {repliesQuery.isPending ? (
          <div className="px-4 sm:px-5">
            <CardSkeleton lines={3} />
          </div>
        ) : repliesQuery.isError ? (
          <div className="px-4 sm:px-5">
            <ErrorState error={repliesQuery.error} onRetry={() => void repliesQuery.refetch()} />
          </div>
        ) : (
          <ul aria-label="Thread replies">
            {replies.map((message, index) => (
              <MessageRow
                key={message.id}
                message={message}
                grouped={
                  index > 0 &&
                  replies[index - 1]?.authorId === message.authorId &&
                  message.deletedAt === null &&
                  replies[index - 1]?.deletedAt === null
                }
                reactions={reactionsQuery.data?.get(message.id) ?? []}
                mentions={mentionsQuery.data?.get(message.id) ?? []}
                attachments={attachmentsQuery.data?.get(message.id) ?? []}
                currentUserId={user?.id ?? null}
                actions={actionsFor(message)}
                {...rowHandlers(message)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0">
        {canReply ? (
          <Composer
            placeName={`thread in ${placeName}`}
            placeKind={inConversation ? 'conversation' : 'channel'}
            disabled={false}
            sending={reply.isPending}
            onSend={(body, attachments) => reply.mutate({ body, attachments })}
            onTyping={() => undefined}
            mentionCandidates={mentionCandidatesQuery.data ?? []}
          />
        ) : (
          <div className="px-4 pb-4">
            <p className="border-border text-muted-foreground text-2xs rounded-md border border-dashed px-3 py-2.5 text-center">
              {!rootAlive
                ? 'This message was deleted. The thread stays, but it takes no new replies.'
                : placeArchived
                  ? 'This channel is archived.'
                  : 'You do not have permission to reply here.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** The line under a message that says a thread hangs off it. */
export function ThreadSummary({ message, onOpen }: { message: Message; onOpen: () => void }) {
  if (message.replyCount === 0) return null

  const when = message.lastReplyAt ? new Date(message.lastReplyAt) : null

  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-accent-text hover:bg-accent mt-1 -ml-1.5 flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs font-medium transition-colors duration-[120ms]"
    >
      {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
      {when ? (
        <span className="text-muted-foreground font-mono font-normal">
          · {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      ) : null}
    </button>
  )
}
