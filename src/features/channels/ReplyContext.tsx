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
        'text-2xs text-muted-foreground/75 flex min-w-0 items-center gap-1 leading-4',
        className,
      )}
    >
      <ArrowBendUpLeft className="size-3 shrink-0 opacity-70" aria-hidden="true" />

      {context === null ? (
        <span className="truncate italic">Message unavailable</span>
      ) : (
        <>
          <span className="text-foreground/70 shrink-0 font-medium">{context.authorName}</span>
          <span className="shrink-0 opacity-50" aria-hidden="true">
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
              <span className="truncate">{replyPreviewOf(context.body)}</span>
            </>
          )}
        </>
      )}
    </span>
  )
}
