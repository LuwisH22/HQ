import { useEffect, useMemo, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Gear, Hash, LockSimple, Users } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardSkeleton, EmptyState, ErrorState, ForbiddenState } from '@/components/common/states'
import { messageService } from '@/services/message.service'
import type { Message } from '@/services/message.service'
import { organizationService } from '@/services/organization.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/hooks/use-auth'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { useChannelByKey } from './use-channels'
import { useChannelRealtime } from './use-channel-realtime'
import { TypingIndicator } from './TypingIndicator'
import { MessageRow, DayDivider } from './MessageRow'
import { Composer } from './Composer'

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

  const realtime = useChannelRealtime(channel?.id ?? null, user?.id ?? null, () => {
    void invalidateMessages()
  })

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

  const memberCount = membersQuery.data?.length ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Compact by design: the conversation is the page, and every row this
          header takes is a row of it nobody can read. */}
      <header className="border-border bg-surface/60 flex h-14 shrink-0 items-center gap-2.5 border-b px-3 sm:px-4">
        <Button asChild size="icon-sm" variant="ghost" className="md:hidden">
          <Link to="/channels" aria-label="Back to channels">
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
        </Button>

        {channel.isPrivate ? (
          <LockSimple className="text-muted-foreground size-4 shrink-0" aria-label="Private" />
        ) : (
          <Hash className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        )}

        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="truncate text-sm leading-tight font-semibold">{channel.name}</h1>
          {channel.topic ? (
            <>
              <span className="bg-border h-3 w-px shrink-0" aria-hidden="true" />
              <p className="text-muted-foreground text-2xs hidden truncate sm:block">
                {channel.topic}
              </p>
            </>
          ) : null}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {channel.archivedAt ? <Badge variant="warning">Archived</Badge> : null}
          {memberCount > 0 ? (
            <span
              className="text-muted-foreground text-2xs flex items-center gap-1 tabular-nums"
              aria-label={`${String(memberCount)} members`}
            >
              <Users className="size-3.5" aria-hidden="true" />
              {memberCount}
            </span>
          ) : null}
          {canManage ? (
            <Button asChild size="icon-sm" variant="ghost" className="text-muted-foreground">
              <Link to="/settings/channels" aria-label="Channel settings">
                <Gear className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Wide, but not unreadably so on an ultrawide monitor. `justify-end`
            keeps a short conversation sitting on the composer rather than
            floating at the top of an empty screen. */}
        <div className="mx-auto flex min-h-full w-full max-w-[1100px] flex-col justify-end py-4">
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
                      actions={{
                        // Editing belongs to the author. Moderation confers
                        // removal, never rewriting somebody else's words.
                        canEdit: isMine,
                        canPin,
                        canDelete: isMine || canModerate,
                      }}
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

      <div className="mx-auto w-full max-w-[1100px] shrink-0">
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
        />
      </div>
    </div>
  )
}
