import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  DotsThree,
  Hash,
  LockSimple,
  PaperPlaneTilt,
  PushPin,
} from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CardSkeleton, EmptyState, ErrorState, ForbiddenState } from '@/components/common/states'
import { channelService } from '@/services/channel.service'
import { messageService } from '@/services/message.service'
import type { Message } from '@/services/message.service'
import { organizationService } from '@/services/organization.service'
import { initialsFor } from '@/services/profile.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/hooks/use-auth'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { useChannelRealtime } from './use-channel-realtime'
import { TypingIndicator } from './TypingIndicator'

/**
 * One channel's conversation.
 *
 * Access is not decided here. The channel row and its messages only arrive if
 * RLS allowed them, so an inaccessible channel produces an empty result rather
 * than a hidden one — including for a guessed id in the address bar.
 */
export function ChannelChatPage() {
  const { channelKey } = useParams<{ channelKey: string }>()
  const { organization } = useWorkspace()
  const { user } = useAuth()
  const organizationId = organization?.id
  const canView = usePermission('channels.view')
  const canModerate = usePermission('messages.moderate')
  const canPin = usePermission('messages.pin')
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<Message | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const channelsQuery = useQuery({
    queryKey: ['channels', organizationId ?? 'none'],
    queryFn: () => channelService.listChannels(organizationId as string),
    enabled: Boolean(organizationId) && canView,
  })

  const channel = useMemo(
    () => (channelsQuery.data ?? []).find((c) => c.key === channelKey) ?? null,
    [channelsQuery.data, channelKey],
  )

  const messagesQuery = useQuery({
    queryKey: ['messages', channel?.id ?? 'none'],
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

  const realtime = useChannelRealtime(channel?.id ?? null, user?.id ?? null, () => {
    void queryClient.invalidateQueries({ queryKey: ['messages', channel?.id ?? 'none'] })
  })

  const typingNames = useMemo(() => {
    const byUser = new Map((membersQuery.data ?? []).map((m) => [m.userId, m.profile]))
    return (
      realtime.typingUserIds
        // Someone the roster does not recognise is dropped rather than rendered:
        // a spoofed id cannot put an arbitrary label on screen.
        .map((id) => byUser.get(id))
        .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
        .map((profile) => profile.displayName ?? profile.fullName ?? profile.email)
    )
  }, [realtime.typingUserIds, membersQuery.data])

  const messages = messagesQuery.data?.messages ?? []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const send = useMutation({
    mutationFn: (body: string) => messageService.send(channel?.id as string, body),
    onSuccess: async () => {
      setDraft('')
      realtime.clearTyping()
      await queryClient.invalidateQueries({ queryKey: ['messages', channel?.id ?? 'none'] })
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const saveEdit = useMutation({
    mutationFn: (input: { id: string; body: string }) => messageService.edit(input.id, input.body),
    onSuccess: async () => {
      setEditing(null)
      await queryClient.invalidateQueries({ queryKey: ['messages', channel?.id ?? 'none'] })
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => messageService.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages', channel?.id ?? 'none'] })
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const pin = useMutation({
    mutationFn: (input: { id: string; pinned: boolean }) =>
      messageService.setPinned(input.id, input.pinned),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages', channel?.id ?? 'none'] })
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  if (!canView) return <ForbiddenState />

  if (channelsQuery.isPending) {
    return <CardSkeleton lines={8} />
  }

  if (!channel) {
    return (
      <EmptyState
        icon={Hash}
        title="Channel not found"
        description="It may have been deleted, or you may not have access to it."
      />
    )
  }

  return (
    // Full height so the transcript scrolls and the composer stays put, but
    // bounded and padded like every other screen.
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col p-4 sm:p-6">
      <header className="border-border flex items-center gap-2 border-b pb-3">
        <Button asChild size="icon-sm" variant="ghost">
          <Link to="/channels" aria-label="Back to channels">
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
        </Button>
        {channel.isPrivate ? (
          <LockSimple className="text-muted-foreground size-4" aria-label="Private channel" />
        ) : (
          <Hash className="text-muted-foreground size-4" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm leading-tight font-semibold">{channel.name}</h1>
          {channel.topic ? (
            <p className="text-2xs text-muted-foreground truncate">{channel.topic}</p>
          ) : null}
        </div>
        {channel.archivedAt ? <Badge variant="warning">Archived</Badge> : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        {messagesQuery.isPending ? (
          <CardSkeleton lines={6} />
        ) : messagesQuery.isError ? (
          <ErrorState error={messagesQuery.error} onRetry={() => void messagesQuery.refetch()} />
        ) : messages.length === 0 ? (
          <EmptyState
            icon={Hash}
            title="No messages yet"
            description={`This is the beginning of #${channel.name}.`}
          />
        ) : (
          <ul className="space-y-3" aria-label="Messages">
            {messages.map((message) => {
              const isMine = message.authorId === user?.id
              const isEditing = editing?.id === message.id

              return (
                <li key={message.id} className="group flex items-start gap-2.5">
                  <Avatar className="mt-0.5 size-7 shrink-0">
                    {message.authorAvatarUrl ? (
                      <AvatarImage src={message.authorAvatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback>
                      {initialsFor({ displayName: message.authorName })}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2">
                      <span className="text-xs font-medium">{message.authorName}</span>
                      <span className="text-3xs text-muted-foreground/70">
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {message.pinnedAt ? (
                        <PushPin className="text-accent-text size-3" aria-label="Pinned" />
                      ) : null}
                    </p>

                    {message.deletedAt ? (
                      <p className="text-muted-foreground/70 text-xs italic">
                        This message was deleted.
                      </p>
                    ) : isEditing ? (
                      <form
                        className="mt-1 flex gap-2"
                        onSubmit={(event) => {
                          event.preventDefault()
                          if (editDraft.trim()) {
                            saveEdit.mutate({ id: message.id, body: editDraft })
                          }
                        }}
                      >
                        <Input
                          value={editDraft}
                          onChange={(event) => setEditDraft(event.target.value)}
                          aria-label="Edit message"
                          autoFocus
                        />
                        <Button type="submit" size="sm" loading={saveEdit.isPending}>
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <p className="text-xs leading-relaxed break-words whitespace-pre-wrap">
                        {message.body}
                        {message.editedAt ? (
                          <span className="text-3xs text-muted-foreground/60"> (edited)</span>
                        ) : null}
                      </p>
                    )}
                  </div>

                  {!message.deletedAt && (isMine || canModerate || canPin) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={`Actions for message from ${message.authorName}`}
                        >
                          <DotsThree aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        {/* Editing belongs to the author. Moderation confers
                            removal, never rewriting someone's words. */}
                        {isMine ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(message)
                              setEditDraft(message.body)
                            }}
                          >
                            Edit message
                          </DropdownMenuItem>
                        ) : null}
                        {canPin ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              pin.mutate({ id: message.id, pinned: message.pinnedAt === null })
                            }
                          >
                            {message.pinnedAt ? 'Unpin message' : 'Pin message'}
                          </DropdownMenuItem>
                        ) : null}
                        {isMine || canModerate ? (
                          <DropdownMenuItem
                            destructive
                            onSelect={() => {
                              if (window.confirm('Delete this message?')) remove.mutate(message.id)
                            }}
                          >
                            Delete message
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <TypingIndicator names={typingNames} />

      <form
        className="flex gap-2 pt-1"
        onSubmit={(event) => {
          event.preventDefault()
          if (draft.trim()) send.mutate(draft)
        }}
      >
        <Input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            // Throttled inside the hook: a burst of keystrokes sends at most
            // one event, and silence sends a stop after two seconds.
            realtime.noteTyping()
          }}
          onBlur={() => realtime.clearTyping()}
          placeholder={`Message #${channel.name}`}
          aria-label={`Message ${channel.name}`}
          maxLength={4000}
        />
        <Button type="submit" loading={send.isPending} disabled={draft.trim().length === 0}>
          <PaperPlaneTilt className="size-3.5" aria-hidden="true" />
          Send
        </Button>
      </form>
    </div>
  )
}
