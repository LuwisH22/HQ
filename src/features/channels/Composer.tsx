import { useEffect, useRef, useState } from 'react'
import { PaperPlaneTilt } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { MentionCandidate } from '@/services/channel.service'
import { cn } from '@/lib/utils'
import { MentionAutocomplete } from './MentionAutocomplete'
import { applyMention, mentionQueryAt, useMentionMenu } from './mentions'

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
  mentionCandidates = [],
}: {
  channelName: string
  disabled: boolean
  /** Shown in place of the field when sending is not allowed. */
  disabledReason?: string
  sending: boolean
  onSend: (body: string) => void
  onTyping: () => void
  /** Who may be mentioned here. Empty disables the menu entirely. */
  mentionCandidates?: readonly MentionCandidate[]
}) {
  const [draft, setDraft] = useState('')
  const [caret, setCaret] = useState(0)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  // Only while the caret sits inside an unfinished `@handle`. Typing an
  // address or a price never opens it.
  const query = mentionCandidates.length === 0 ? null : mentionQueryAt(draft, caret)
  const menu = useMentionMenu(mentionCandidates, query?.term ?? null)
  const menuOpen = query !== null && menu.matches.length > 0

  function choose(candidate: MentionCandidate): void {
    if (!query) return
    const next = applyMention(draft, query, candidate.handle, caret)
    setDraft(next.value)
    setCaret(next.caret)

    // The caret has to land after the inserted handle, or the next character
    // typed reopens the menu on text that is already finished.
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
    })
  }

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
    setCaret(0)
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
    <div className="relative px-4 pb-3" role="group" aria-label={`Composer for ${channelName}`}>
      {menuOpen ? (
        <div className="absolute inset-x-4 bottom-full">
          <MentionAutocomplete
            candidates={menu.matches}
            term={query.term}
            activeIndex={menu.activeIndex}
            onPick={choose}
            onHover={menu.setActiveIndex}
          />
        </div>
      ) : null}
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
            setCaret(event.target.selectionStart)
            // Throttled inside the realtime hook: a burst of keystrokes sends
            // at most one event, and silence sends a stop after two seconds.
            onTyping()
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onBlur={() => setCaret(-1)}
          onKeyDown={(event) => {
            // The menu owns these keys while it is open, or Enter would send a
            // half-typed handle instead of completing it.
            if (menuOpen) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                menu.move(1)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                menu.move(-1)
                return
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                const picked = menu.matches[menu.activeIndex]
                if (picked) choose(picked)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                // Dismiss without touching the text: the caret moves out of
                // the handle, which is what closes the menu.
                setCaret(-1)
                return
              }
            }

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
