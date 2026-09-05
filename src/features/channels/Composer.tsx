import { useEffect, useRef, useState } from 'react'
import { PaperPlaneTilt } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * The message composer.
 *
 * Enter sends and Shift+Enter breaks the line, which is what everyone who has
 * used a chat application expects; the hint under the field says so once,
 * quietly, rather than leaving it to be discovered.
 *
 * The field grows with its content up to a few lines and then scrolls, so a
 * long message stays editable without the conversation above it disappearing.
 */

const MAX_LENGTH = 4000
/** Roughly seven lines. Past that the field scrolls instead of growing. */
const MAX_HEIGHT_PX = 168

export function Composer({
  channelName,
  disabled,
  disabledReason,
  sending,
  onSend,
  onTyping,
}: {
  channelName: string
  disabled: boolean
  /** Shown in place of the field when sending is not allowed. */
  disabledReason?: string
  sending: boolean
  onSend: (body: string) => void
  onTyping: () => void
}) {
  const [draft, setDraft] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)

  // Re-measure from scratch each time: shrinking back after a deletion needs
  // the height reset before scrollHeight means anything.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${String(Math.min(el.scrollHeight, MAX_HEIGHT_PX))}px`
  }, [draft])

  function submit(): void {
    const body = draft.trim()
    if (!body || disabled || sending) return
    onSend(body)
    setDraft('')
  }

  if (disabled) {
    return (
      <div className="px-4 pb-4" role="group" aria-label={`Composer for ${channelName}`}>
        <p className="border-border text-muted-foreground text-2xs rounded-md border border-dashed px-3 py-2.5 text-center">
          {disabledReason ?? 'You do not have permission to send messages here.'}
        </p>
      </div>
    )
  }

  return (
    <div className="px-4 pb-3" role="group" aria-label={`Composer for ${channelName}`}>
      <div
        className={cn(
          'border-input bg-background rounded-md border transition-[border-color] duration-[140ms]',
          'focus-within:border-primary',
        )}
      >
        <Textarea
          ref={ref}
          rows={1}
          value={draft}
          maxLength={MAX_LENGTH}
          placeholder={`Message #${channelName}`}
          aria-label={`Message ${channelName}`}
          className="max-h-[168px] min-h-[38px] border-0 bg-transparent px-3 py-2.5 focus-visible:border-0"
          onChange={(event) => {
            setDraft(event.target.value)
            // Throttled inside the realtime hook: a burst of keystrokes sends
            // at most one event, and silence sends a stop after two seconds.
            onTyping()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />

        <div className="flex items-center gap-2 px-2 pb-2">
          <p className="text-3xs text-muted-foreground/60 flex-1 pl-1">
            <kbd className="font-sans font-medium">Enter</kbd> to send ·{' '}
            <kbd className="font-sans font-medium">Shift + Enter</kbd> for a new line
          </p>
          {draft.length > MAX_LENGTH - 200 ? (
            <span className="text-3xs text-muted-foreground tabular-nums">
              {String(MAX_LENGTH - draft.length)}
            </span>
          ) : null}
          <Button size="sm" loading={sending} disabled={draft.trim().length === 0} onClick={submit}>
            <PaperPlaneTilt className="size-3.5" aria-hidden="true" />
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
