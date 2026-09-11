import { ArrowBendUpLeft, Paperclip } from '@phosphor-icons/react'
import type { ReplyContext } from '@/services/message.service'
import { cn } from '@/lib/utils'
import { replyPreviewOf } from './replies'

/**
 * The line that says what a reply is answering.
 *
 * One line, above the words, secondary to them — the reply is the message and
 * the quote is only context. It appears twice: over the composer while a reply
 * is being written, and over the reply itself once it is sent, so the two read
 * the same and there is one place to change how a quote looks.
 *
 * The preview is plain text in a span. Not a MessageBody: that renders
 * mentions and needs the mention rows to do it, and a quote wants no
 * formatting anyway. React escapes it, so there is no path here for markup of
 * any kind — and a `ReplyContext` carries no storage path to leak in the first
 * place, only a count of the files that rode along.
 *
 * A 2px accent rule and nothing else — no fill, no border, no radius. Inside a
 * bubble a bordered box would read as a card inside a card; a rule reads as a
 * margin note, which is what a quote is.
 */

export function ReplyContextLine({
  context,
  className,
}: {
  /** Absent when the parent is gone, or in a place this reader cannot see. */
  context: ReplyContext | null
  className?: string
}) {
  return (
    <span
      className={cn(
        // A rule rather than an outline: the quote hangs off the line, which
        // points at the message it answers. 12/18 muted, and one line only —
        // a quote is a single glance, not a second message.
        'text-muted-foreground border-accent-text flex min-w-0 items-center gap-1.5 border-l-2 pl-2.5 text-xs leading-[18px]',
        className,
      )}
    >
      <ArrowBendUpLeft className="size-3 shrink-0 opacity-70" aria-hidden="true" />

      {context === null ? (
        <span className="truncate italic">Message unavailable</span>
      ) : (
        <>
          <span className="text-secondary-foreground shrink-0 text-xs font-medium">
            {context.authorName}
          </span>
          {/* A separator, not a time. The audit asks for the quoted
              message's timestamp in mono, but `ReplyContext` is deliberately
              narrow — a name, a few words and a file count — and putting a
              `createdAt` on it is a service contract change, which this work
              is not allowed to make. */}
          <span className="text-3xs shrink-0 font-mono opacity-60" aria-hidden="true">
            ·
          </span>
          {context.deleted ? (
            <span className="truncate italic">This message was deleted.</span>
          ) : (
            <>
              {context.attachmentCount > 0 ? (
                <Paperclip
                  className="size-3 shrink-0 opacity-70"
                  aria-label={
                    context.attachmentCount === 1
                      ? 'with a file'
                      : `with ${String(context.attachmentCount)} files`
                  }
                />
              ) : null}
              {/* 48ch is the audit's ceiling: long enough to recognise a
                  message, short enough that the quote never competes with the
                  reply under it. */}
              <span className="max-w-[48ch] truncate">{replyPreviewOf(context.body)}</span>
            </>
          )}
        </>
      )}
    </span>
  )
}
