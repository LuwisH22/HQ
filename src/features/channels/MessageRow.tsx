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
import type { Arrival } from './message-arrival'
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
 *
 * The words sit in a bubble: the L1 card the rest of the app uses, at the
 * prose radius, and one step sideways for your own message rather than one
 * step up. Everyone stays in the same left column — an operations channel is
 * read as a record of who said what, not as a two-person exchange — so
 * ownership is the tint and the name line, never the side of the screen.
 *
 * The `li` stays a list item and an `article` sits inside it. The message is
 * the article: it carries the name and the entrance. The list item is the band
 * around it that tints on hover and holds the gutter.
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
  continuesBelow = false,
  arrival,
  onSettled,
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
  /**
   * Another message in the same group follows this one.
   *
   * Only the corners read it: the edge that faces a sibling tightens. It is
   * the same `continuesRun` the caller already used for `grouped`, asked about
   * the message below instead of the one above — there is no second rule here.
   */
  continuesBelow?: boolean
  /**
   * How this message got here, when it has only just got here. Drives the
   * entrance on the bubble and nothing else.
   */
  arrival?: Arrival
  /** Called once the entrance has finished, so the class can come off. */
  onSettled?: () => void
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

  // Yours, by the id the session already established. Nothing is sent down to
  // say so and nothing needs to be: the tint is a fact about who is reading.
  const isOwn = currentUserId !== null && message.authorId === currentUserId

  // The corners that face a sibling in the same group tighten from 8 to 3.
  // Bubbles keep their own edges; nothing is merged into a shared card, and
  // that is the whole of the first/middle/last distinction.
  const BUBBLE = cn(
    'chat-bubble',
    isOwn ? 'chat-bubble-own' : null,
    grouped ? 'chat-bubble-above' : null,
    continuesBelow ? 'chat-bubble-below' : null,
  )

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
        // 2px between messages inside a group, 12px before a new one: the
        // rhythm is what separates one person talking from two.
        grouped ? 'py-px' : 'mt-3 py-px first:mt-0',
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
      <div data-message-gutter="" className="relative w-8 shrink-0 sm:w-9">
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
          <span className="text-3xs text-muted-foreground/0 group-focus-within:text-muted-foreground group-hover:text-muted-foreground absolute top-px right-0 text-right font-mono leading-[22px] whitespace-nowrap tabular-nums transition-colors">
            {shortTime(message.createdAt)}
          </span>
        ) : (
          <Avatar className="size-8 rounded-md sm:size-9">
            {message.authorAvatarUrl ? <AvatarImage src={message.authorAvatarUrl} alt="" /> : null}
            <AvatarFallback className="rounded-md">
              {initialsFor({ displayName: message.authorName })}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      {/* The message itself. An article inside the list item so a message is
          one named thing to a screen reader, while the band around it stays
          the list row that tints on hover and holds the gutter.

          NOT a tab stop, and that is deliberate. Making it one put a focus
          target around the action chip, and a click on the chip then scrolled
          the row into view mid-gesture — the message list moved by 53px while
          the reaction menu was opening, and Radix had already positioned that
          menu against where the trigger used to be. It landed 100px below the
          viewport, unreachable by mouse or keyboard. Measured, not guessed:
          `e2e/direct-messages.spec.ts` fails on it.

          Nothing is lost. Everything a message offers is a real button in the
          tab order, the chip appears on `focus-within` so the keyboard reaches
          the same tools the pointer does, and a reader navigates these by
          article rather than by tabbing through two hundred of them. */}
      <article
        aria-label={`${message.authorName}, ${shortTime(message.createdAt)}${
          removed ? ', deleted message' : ''
        }`}
        // A flex column that shrink-wraps its children: a bubble is as wide as
        // its words and no wider, up to the ceiling. Without this every bubble
        // is a block and fills the column, which is a card, not a message.
        className="flex min-w-0 flex-1 flex-col items-start"
      >
        {grouped ? null : (
          <p className="mb-0.5 flex items-baseline gap-2 leading-[18px]">
            <span className="text-foreground text-sm leading-[18px] font-semibold">
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

        {removed ? (
          <>
            {/* An outline where words were: no fill, a dashed edge. The row
                survives so replies to it stay reachable. */}
            <div className={cn(BUBBLE, 'chat-bubble-deleted')}>
              <p className="text-sm italic">This message was deleted.</p>
            </div>
            {onOpenThread ? <ThreadSummary message={message} onOpen={onOpenThread} /> : null}
          </>
        ) : editing ? (
          <form
            className="mt-1 flex w-full flex-wrap items-center gap-2"
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
            <div
              className={cn(BUBBLE, arrival === 'own' ? 'chat-enter-own' : null, arrival === 'incoming' ? 'chat-enter-incoming' : null, arrival !== undefined ? 'chat-arrived' : null)}
              // The entrance is on the bubble, so the class comes off the
              // bubble: a settled message carries no transform at all. Only
              // this element's own animations count — a reaction chip's
              // transition inside it must not end the message's entrance.
              onAnimationEnd={(event) => {
                if (event.currentTarget === event.target) onSettled?.()
              }}
            >
              {/* Above the words and inside the bubble: the reply is the
                  message, and this is only what it answers. */}
              {replyContext !== undefined ? (
                onJumpToParent ? (
                  <button
                    type="button"
                    onClick={onJumpToParent}
                    className="-mx-1 mb-1 flex w-[calc(100%+0.5rem)] min-w-0 rounded-sm px-1 text-left"
                    aria-label={
                      replyContext === null
                        ? 'Go to the message this replies to'
                        : `Go to the message from ${replyContext.authorName} this replies to`
                    }
                  >
                    <ReplyContextLine context={replyContext} />
                  </button>
                ) : (
                  <ReplyContextLine context={replyContext} className="mb-1" />
                )
              ) : null}

              <MessageBody
                body={message.body}
                mentions={mentions}
                currentUserId={currentUserId}
                edited={message.editedAt !== null}
              />
              <MessageAttachments attachments={attachments} />
            </div>

            {/* Beneath the bubble, not in it: a reaction and a thread belong
                to the message without being part of what was said. */}
            <MessageReactions
              reactions={reactions}
              canReact={actions.canReact}
              onPick={onReact}
              onToggle={(emoji, mine) => (mine ? onUnreact(emoji) : onReact(emoji))}
            />
            {onOpenThread ? <ThreadSummary message={message} onOpen={onOpenThread} /> : null}
          </>
        )}
      </article>

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
