import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { CardSkeleton, ErrorState } from '@/components/common/states'
import { channelService } from '@/services/channel.service'
import { messageService } from '@/services/message.service'
import type { Message } from '@/services/message.service'
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
  channelName,
  channelArchived,
  onClose,
}: {
  root: Message
  channelName: string
  channelArchived: boolean
  onClose: () => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const canSend = usePermission('messages.send')
  const canModerate = usePermission('messages.moderate')
  const canPin = usePermission('messages.pin')

  const repliesQuery = useQuery({
    queryKey: queryKeys.messages.replies(root.id),
    queryFn: () => messageService.listReplies(root.id),
  })

  const replies = repliesQuery.data ?? []
  const ids = [root.id, ...replies.map((r) => r.id)]

  const mentionsQuery = useQuery({
    queryKey: [...queryKeys.messages.mentions(root.channelId), 'thread', root.id, ids.length],
    queryFn: () => messageService.listMentions(ids),
  })

  const mentionCandidatesQuery = useQuery({
    queryKey: queryKeys.channelMembers.mentionable(root.channelId),
    queryFn: () => channelService.listMentionCandidates(root.channelId),
    staleTime: 5 * 60_000,
  })

  const reactionsQuery = useQuery({
    queryKey: [...queryKeys.messages.reactions(root.channelId), 'thread', root.id, ids.length],
    queryFn: () => messageService.listReactions(ids),
  })

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: queryKeys.messages.replies(root.id) })
    await queryClient.invalidateQueries({
      queryKey: queryKeys.messages.mentions(root.channelId),
    })
    // The root's reply count lives on the message itself, so the timeline is
    // stale as soon as a reply lands.
    await queryClient.invalidateQueries({ queryKey: queryKeys.messages.list(root.channelId) })
  }

  const reply = useMutation({
    mutationFn: (body: string) => messageService.send(root.channelId, body, root.id),
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
  const canReply = canSend && !channelArchived && rootAlive

  function actionsFor(message: Message) {
    return {
      canEdit: message.authorId === user?.id,
      canPin,
      canDelete: message.authorId === user?.id || canModerate,
      canReact: canSend && !channelArchived,
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
      <header className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Back to channel details"
          onClick={onClose}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <div className="min-w-0">
          <h2 className="text-3xs text-foreground/42 font-semibold tracking-[0.1em] uppercase">
            Thread
          </h2>
          <p className="text-2xs text-muted-foreground truncate">#{channelName}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <ul aria-label="Thread">
          <MessageRow
            message={root}
            grouped={false}
            reactions={reactionsQuery.data?.get(root.id) ?? []}
            mentions={mentionsQuery.data?.get(root.id) ?? []}
            currentUserId={user?.id ?? null}
            actions={actionsFor(root)}
            {...rowHandlers(root)}
          />
        </ul>

        <div className="flex items-center gap-2 px-4 py-2" aria-hidden="true">
          <span className="border-border flex-1 border-t" />
          <span className="text-3xs text-muted-foreground/70">
            {replies.length === 0
              ? 'No replies yet'
              : `${String(replies.length)} ${replies.length === 1 ? 'reply' : 'replies'}`}
          </span>
          <span className="border-border flex-1 border-t" />
        </div>

        {repliesQuery.isPending ? (
          <div className="px-4">
            <CardSkeleton lines={3} />
          </div>
        ) : repliesQuery.isError ? (
          <div className="px-4">
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
            channelName={`thread in ${channelName}`}
            disabled={false}
            sending={reply.isPending}
            onSend={(body) => reply.mutate(body)}
            onTyping={() => undefined}
            mentionCandidates={mentionCandidatesQuery.data ?? []}
          />
        ) : (
          <div className="px-4 pb-4">
            <p className="border-border text-muted-foreground text-2xs rounded-md border border-dashed px-3 py-2.5 text-center">
              {!rootAlive
                ? 'This message was deleted. The thread stays, but it takes no new replies.'
                : channelArchived
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
      className="text-accent-text hover:bg-foreground/7 focus-visible:ring-ring mt-1 flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
      {when ? (
        <span className="text-muted-foreground/70 font-normal">
          · {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      ) : null}
    </button>
  )
}
