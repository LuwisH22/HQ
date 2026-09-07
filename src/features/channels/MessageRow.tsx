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
import type {
  Message,
  MessageMention,
  MessageReaction,
  ReplyContext,
} from '@/services/message.service'
import type { MessageAttachment } from '@/services/attachment.service'
import { MessageReactions, ReactionPicker } from './MessageReactions'
import { MessageAttachments } from './MessageAttachments'
import { MessageBody } from './MessageBody'
import { ThreadSummary } from './ThreadPanel'
import { ReplyContextLine } from './ReplyContext'
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
  replyContext,
  highlighted = false,
  currentUserId,
  onEdit,
  onTogglePin,
  onDelete,
  onReact,
  onUnreact,
  onReply,
  onOpenThread,
  onJumpToParent,
}: {
  message: Message
  /** Continues the message above it: no avatar, no name. */
  grouped: boolean
  actions: MessageActions
  reactions: readonly MessageReaction[]
  mentions: readonly MessageMention[]
  /** Files on this message. Gone with its words when it is deleted. */
  attachments?: readonly MessageAttachment[]
  /**
   * What this message is answering, when it answers something. Undefined on a
   * message that replies to nothing; null when the parent is out of reach.
   */
  replyContext?: ReplyContext | null
  /** Briefly, after somebody followed a reply back to it. */
  highlighted?: boolean
  /** Who is reading, so a mention of them can look different. */
  currentUserId: string | null
  onEdit: (body: string) => void
  onTogglePin: () => void
  onDelete: () => void
  onReact: (emoji: string) => void
  onUnreact: (emoji: string) => void
  /**
   * Start a reply to this message in the room's own composer. Omitted where
   * there is nothing further to reply to — inside a thread, and on a reply,
   * which the database will not let anybody reply to either.
   */
  onReply?: () => void
  /** Open the thread panel. Drives the reply count, and nothing else does. */
  onOpenThread?: () => void
  /** Follow the quote back to the message it came from. */
  onJumpToParent?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body)

  const removed = message.deletedAt !== null
  const canReply = onReply !== undefined && !removed
  const showActions =
    !removed &&
    (actions.canEdit || actions.canPin || actions.canDelete || actions.canReact || canReply)

  // Read off the rows the database recorded, the same ones the body highlights
  // from. Nothing here parses the text, so a message can only look like it
  // names you if `message_mentions` says it does.
  const mentionsMe = currentUserId !== null && mentions.some((m) => m.userId === currentUserId)

  return (
    <li
      data-message-id={message.id}
      data-highlighted={highlighted || undefined}
      className={cn(
        // The band is the row, inset 8px from the column's edges: text lands
        // at 20 on a wide screen and 16 on a phone, and the hover fill is the
        // width of the conversation rather than a card floating in it.
        'group relative mx-2 flex gap-3 rounded-md pr-2 pl-2 transition-colors duration-[120ms] sm:pl-3',
        'hover:bg-surface',
        grouped ? 'py-0.5' : 'mt-2.5 py-0.5 first:mt-0',
        // Being named is worth noticing across a room: a blade in the gutter
        // and the quietest possible tint behind the words.
        mentionsMe && !removed ? 'bg-primary/6 hover:bg-primary/10' : null,
        message.pinnedAt ? 'bg-brass/5 hover:bg-brass/8' : null,
        // Where a jump landed. It fades on its own; nothing has to be pressed
        // to dismiss it.
        highlighted ? 'bg-primary/14 hover:bg-primary/14' : null,
      )}
    >
      {mentionsMe && !removed ? (
        <span
          aria-hidden="true"
          className="bg-accent-text absolute top-1/2 -left-0.5 h-4 w-0.5 -translate-y-1/2 rounded-full"
        />
      ) : null}
      {/* The avatar column, and the hover timestamp's home. Named, because
          measuring it by its width class made a spacing change a test
          failure. */}
      <div data-message-gutter="" className="relative w-9 shrink-0">
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
          <span className="text-2xs text-muted-foreground/0 group-hover:text-muted-foreground absolute top-px right-0 text-right font-mono leading-[22px] whitespace-nowrap tabular-nums transition-colors">
            {shortTime(message.createdAt)}
          </span>
        ) : (
          <Avatar className="size-9 rounded-md">
            {message.authorAvatarUrl ? <AvatarImage src={message.authorAvatarUrl} alt="" /> : null}
            <AvatarFallback className="rounded-md">
              {initialsFor({ displayName: message.authorName })}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {grouped ? null : (
          <p className="flex items-baseline gap-2 leading-[18px]">
            <span className="text-foreground text-base leading-[18px] font-semibold">
              {message.authorName}
            </span>
            {message.pinnedAt ? (
              <PushPin
                weight="fill"
                className="text-brass size-3 self-center"
                aria-label="Pinned"
              />
            ) : null}
            <span className="text-2xs text-muted-foreground font-mono tabular-nums">
              {shortTime(message.createdAt)}
            </span>
          </p>
        )}

        {/* Above the words and below the name: the reply is the message, and
            this is only what it answers. */}
        {replyContext !== undefined && !removed ? (
          onJumpToParent ? (
            <button
              type="button"
              onClick={onJumpToParent}
              className="hover:bg-accent mb-0.5 flex w-full min-w-0 rounded-sm py-px text-left transition-colors duration-[120ms]"
              aria-label={
                replyContext === null
                  ? 'Go to the message this replies to'
                  : `Go to the message from ${replyContext.authorName} this replies to`
              }
            >
              <ReplyContextLine context={replyContext} />
            </button>
          ) : (
            <ReplyContextLine context={replyContext} className="mb-0.5" />
          )
        ) : null}

        {removed ? (
          <>
            <p className="text-muted-foreground text-base italic">This message was deleted.</p>
            {onOpenThread ? <ThreadSummary message={message} onOpen={onOpenThread} /> : null}
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
            {onOpenThread ? <ThreadSummary message={message} onOpen={onOpenThread} /> : null}
          </>
        )}
      </div>

      {showActions && !editing ? (
        <div
          className={cn(
            'border-border bg-popover absolute -top-3.5 right-2 flex items-center gap-0.5 rounded-sm border p-0.5 shadow-lg',
            'opacity-0 transition-opacity duration-[120ms]',
            'group-focus-within:opacity-100 group-hover:opacity-100',
          )}
        >
          {actions.canReact ? <ReactionPicker onPick={onReact} label="Add a reaction" /> : null}

          {canReply ? (
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Reply to ${message.authorName}`}
              onClick={onReply}
            >
              <ArrowBendUpLeft aria-hidden="true" />
            </Button>
          ) : null}

          {actions.canPin ? (
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              aria-label={message.pinnedAt ? 'Unpin message' : 'Pin message'}
              onClick={onTogglePin}
            >
              <PushPin aria-hidden="true" />
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Actions for message from ${message.authorName}`}
              >
                <DotsThree aria-hidden="true" />
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
    <li className="mx-2 flex items-center gap-3 px-2 pt-5 pb-5 sm:px-3" aria-hidden="true">
      <span className="border-border-subtle flex-1 border-t" />
      <span className="text-2xs text-muted-foreground font-mono">{label}</span>
      <span className="border-border-subtle flex-1 border-t" />
    </li>
  )
}
