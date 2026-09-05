import { useMemo } from 'react'
import type { MessageMention } from '@/services/message.service'
import { HANDLE_PATTERN } from './mentions'

/**
 * A message body with its mentions highlighted.
 *
 * The spans are decided by the rows the database recorded, not by re-parsing
 * the text hopefully: `@ager` is only styled if `message_mentions` says that
 * message mentions somebody by that handle. Text that merely looks like a
 * mention — a handle nobody holds, an address, a price — stays plain.
 *
 * Rendered as React nodes rather than markup. There is no HTML string here to
 * be injected into, so a message body cannot become script however it is
 * written.
 */

interface Segment {
  text: string
  mentioned: boolean
  /** Whether the mention is of the person reading it. */
  isMe: boolean
}

function segment(
  body: string,
  mentions: readonly MessageMention[],
  currentUserId: string | null,
): Segment[] {
  if (mentions.length === 0) return [{ text: body, mentioned: false, isMe: false }]

  const byHandle = new Map(mentions.map((m) => [m.handle.toLowerCase(), m]))
  const out: Segment[] = []
  let index = 0

  // The same shape the trigger parses by, so what is highlighted is what was
  // recorded. A fresh regex each call: a global one carries lastIndex.
  const pattern = new RegExp(HANDLE_PATTERN.source, 'g')
  let match: RegExpExecArray | null

  while ((match = pattern.exec(body)) !== null) {
    const mention = byHandle.get((match[1] ?? '').toLowerCase())
    if (!mention) continue

    if (match.index > index) {
      out.push({ text: body.slice(index, match.index), mentioned: false, isMe: false })
    }
    out.push({
      text: match[0],
      mentioned: true,
      isMe: mention.userId === currentUserId,
    })
    index = match.index + match[0].length
  }

  if (index < body.length) {
    out.push({ text: body.slice(index), mentioned: false, isMe: false })
  }

  return out
}

export function MessageBody({
  body,
  mentions,
  currentUserId,
  edited,
}: {
  body: string
  mentions: readonly MessageMention[]
  currentUserId: string | null
  edited: boolean
}) {
  const segments = useMemo(
    () => segment(body, mentions, currentUserId),
    [body, mentions, currentUserId],
  )

  return (
    <p
      // The words themselves, as against the line above them quoting somebody
      // else: a row can hold both, and they are not the same text.
      data-message-body=""
      className="text-foreground/92 text-sm leading-relaxed break-words whitespace-pre-wrap"
    >
      {segments.map((part, index) =>
        part.mentioned ? (
          <span
            key={index}
            // Recorded, not guessed: the attribute says a row backs this span.
            data-mention={part.isMe ? 'self' : 'other'}
            // Being named yourself is worth noticing across a room; naming
            // somebody else is worth reading as a name and nothing louder.
            className={
              part.isMe
                ? 'bg-primary/22 text-foreground rounded-xs px-0.5 font-medium'
                : 'text-accent-text font-medium'
            }
          >
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
      {edited ? <span className="text-3xs text-muted-foreground/60"> (edited)</span> : null}
    </p>
  )
}
