import { useState } from 'react'
import { DotsThree, PushPin, ArrowBendUpLeft, PencilSimple } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { initialsFor } from '@/services/profile.service'
import type { Message, MessageMention, MessageReaction } from '@/services/message.service'
import type { MessageAttachment } from '@/services/attachment.service'
import { MessageReactions, ReactionPicker } from './MessageReactions'
import { MessageAttachments } from './MessageAttachments'
import { MessageBody } from './MessageBody'
import { ThreadSummary } from './ThreadPanel'
import { cn } from '@/lib/utils'

/**
 * One message.
 *
 * Consecutive messages from the same author within a few minutes drop the
 * avatar and the name and keep only the body, so a burst of five lines reads
 * as one person talking rather than five separate records. The timestamp is
 * still there on hover, in the space the avatar would have occupied.
 *
 * The actions offered are the ones the caller says are permitted. Editing is
 * the author's alone — moderation confers removal, never rewriting somebody
 * else's words — and the database enforces both regardless of what is drawn.
 */

export interface MessageActions {
  canEdit: boolean
  canPin: boolean
  canDelete: boolean
  /** Reacting is speaking: a deny on messages.send silences this too. */
  canReact: boolean
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageRow({
  message,
  grouped,
  actions,
  reactions,
  mentions,
  attachments = [],
  currentUserId,
  onEdit,
  onTogglePin,
  onDelete,
  onReact,
  onUnreact,
  onReply,
}: {
  message: Message
  /** Continues the message above it: no avatar, no name. */
  grouped: boolean
  actions: MessageActions
  reactions: readonly MessageReaction[]
  mentions: readonly MessageMention[]
  /** Files on this message. Gone with its words when it is deleted. */
  attachments?: readonly MessageAttachment[]
  /** Who is reading, so a mention of them can look different. */
  currentUserId: string | null
  onEdit: (body: string) => void
  onTogglePin: () => void
  onDelete: () => void
  onReact: (emoji: string) => void
  onUnreact: (emoji: string) => void
  /** Omitted inside a thread, where there is nothing further to reply to. */
  onReply?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body)

  const removed = message.deletedAt !== null
  const canReply = onReply !== undefined && !removed
  const showActions =
    !removed &&
    (actions.canEdit || actions.canPin || actions.canDelete || actions.canReact || canReply)

  return (
    <li
      className={cn(
        'group relative flex gap-3 px-4 transition-colors duration-[120ms]',
        'hover:bg-foreground/4',
        grouped ? 'py-0.5' : 'mt-3 py-1 first:mt-0',
        message.pinnedAt ? 'bg-primary/6 hover:bg-primary/9' : null,
      )}
    >
      <div className="relative w-8 shrink-0">
        {grouped ? (
          // Out of flow, never wrapped, and anchored by its right edge only.
          //
          // A locale time is wider than the 32px the avatar sets. In the flow
          // it wrapped, and made every continued message a blank line taller
          // than its own words. Pinned to both edges of the gutter it could
          // not wrap and could not grow either, so the glyphs spilled past the
          // end edge and into the first characters of the message.
          //
          // With only `right` set the box sizes to its text and grows the
          // other way, into the padding the row already has — away from the
          // words rather than over them, whatever the locale writes.
          <span className="text-3xs text-muted-foreground/0 group-hover:text-muted-foreground/60 absolute top-[3px] right-0 text-right leading-5 whitespace-nowrap tabular-nums transition-colors">
            {shortTime(message.createdAt)}
          </span>
        ) : (
          <Avatar className="size-8">
            {message.authorAvatarUrl ? <AvatarImage src={message.authorAvatarUrl} alt="" /> : null}
            <AvatarFallback>{initialsFor({ displayName: message.authorName })}</AvatarFallback>
          </Avatar>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {grouped ? null : (
          <p className="flex items-baseline gap-2">
            <span className="text-foreground text-sm leading-5 font-semibold">
              {message.authorName}
            </span>
            <span className="text-3xs text-muted-foreground/70 tabular-nums">
              {shortTime(message.createdAt)}
            </span>
            {message.pinnedAt ? (
              <PushPin className="text-accent-text size-3" aria-label="Pinned" />
            ) : null}
          </p>
        )}

        {removed ? (
          <>
            <p className="text-muted-foreground/60 text-sm leading-relaxed italic">
              This message was deleted.
            </p>
            {onReply ? <ThreadSummary message={message} onOpen={onReply} /> : null}
          </>
        ) : editing ? (
          <form
            className="mt-1 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (draft.trim()) {
                onEdit(draft)
                setEditing(false)
              }
            }}
          >
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Edit message"
              className="min-w-0 flex-1"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(false)
              }}
            />
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <MessageBody
              body={message.body}
              mentions={mentions}
              currentUserId={currentUserId}
              edited={message.editedAt !== null}
            />
            <MessageAttachments attachments={attachments} />
            <MessageReactions
              reactions={reactions}
              canReact={actions.canReact}
              onPick={onReact}
              onToggle={(emoji, mine) => (mine ? onUnreact(emoji) : onReact(emoji))}
            />
            {onReply ? <ThreadSummary message={message} onOpen={onReply} /> : null}
          </>
        )}
      </div>

      {showActions && !editing ? (
        <div
          className={cn(
            'border-border bg-surface absolute -top-3 right-3 flex items-center gap-0.5 rounded-md border p-0.5',
            'opacity-0 transition-opacity duration-[120ms]',
            'group-focus-within:opacity-100 group-hover:opacity-100',
          )}
        >
          {actions.canReact ? <ReactionPicker onPick={onReact} label="Add a reaction" /> : null}

          {canReply ? (
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground size-6"
              aria-label="Reply in thread"
              onClick={onReply}
            >
              <ArrowBendUpLeft className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}

          {actions.canPin ? (
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground size-6"
              aria-label={message.pinnedAt ? 'Unpin message' : 'Pin message'}
              onClick={onTogglePin}
            >
              <PushPin className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground size-6"
                aria-label={`Actions for message from ${message.authorName}`}
              >
                <DotsThree className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {actions.canEdit ? (
                <DropdownMenuItem
                  onSelect={() => {
                    setDraft(message.body)
                    setEditing(true)
                  }}
                >
                  <PencilSimple className="size-3.5" aria-hidden="true" />
                  Edit message
                </DropdownMenuItem>
              ) : null}
              {actions.canPin ? (
                <DropdownMenuItem onSelect={onTogglePin}>
                  <PushPin className="size-3.5" aria-hidden="true" />
                  {message.pinnedAt ? 'Unpin message' : 'Pin message'}
                </DropdownMenuItem>
              ) : null}
              {actions.canDelete ? (
                <DropdownMenuItem destructive onSelect={onDelete}>
                  Delete message
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </li>
  )
}

/** A day's worth of conversation gets a rule with the date on it. */
export function DayDivider({ date }: { date: string }) {
  const day = new Date(date)
  const today = new Date()
  const isToday = day.toDateString() === today.toDateString()

  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const isYesterday = day.toDateString() === yesterday.toDateString()

  const label = isToday
    ? 'Today'
    : isYesterday
      ? 'Yesterday'
      : day.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <li className="flex items-center gap-3 px-4 pt-5 pb-1" aria-hidden="true">
      <span className="border-border flex-1 border-t" />
      <span className="text-3xs text-muted-foreground/70 font-medium tracking-wide">{label}</span>
      <span className="border-border flex-1 border-t" />
    </li>
  )
}
