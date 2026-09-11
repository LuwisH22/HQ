import { useEffect, useRef, useState } from 'react'
import { Paperclip, PaperPlaneTilt, SpinnerGap, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { MentionCandidate } from '@/services/channel.service'
import type { ReplyContext } from '@/services/message.service'
import { attachmentService } from '@/services/attachment.service'
import type { UploadedAttachment } from '@/services/attachment.service'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { MentionAutocomplete } from './MentionAutocomplete'
import { ReactionPicker } from './MessageReactions'
import { ReplyContextLine } from './ReplyContext'
import { applyMention, mentionQueryAt, useMentionMenu } from './mentions'
import { ATTACHMENT_ACCEPT, formatBytes, rejectAttachment } from './attachments'

/**
 * The message composer.
 *
 * Enter sends and Shift+Enter breaks the line, which is what everyone who has
 * used a chat application expects; the hint under the field says so once,
 * quietly, rather than leaving it to be discovered.
 *
 * The field grows with its content up to a few lines and then scrolls, so a
 * long message stays editable without the conversation above it disappearing.
 *
 * A file starts uploading the moment it is chosen, before there is a message
 * to attach it to. That is what makes sending feel instant, and it is also why
 * an abandoned upload has to be cleaned up: the object exists under the
 * uploader's own prefix, readable by nobody else, until it is either attached
 * or discarded here.
 */

/** One file, from chosen to uploaded. */
interface Pending {
  key: string
  name: string
  size: number
  status: 'uploading' | 'ready' | 'failed'
  upload?: UploadedAttachment
}

/**
 * The three actions are one size: Blackout's 28px icon button on a wide
 * screen, kept at 32 on a phone where the same control is a thumb target. The
 * icon is sized on the button because the variant's own `[&_svg]` rule
 * outranks a class on the icon itself.
 */
const ACTION_BUTTON = 'size-8 sm:size-7 [&_svg]:size-[18px]'

const MAX_LENGTH = 4000
/** Roughly seven lines. Past that the field scrolls instead of growing. */
const MAX_HEIGHT_PX = 168

export function Composer({
  placeName,
  placeKind = 'channel',
  disabled,
  disabledReason,
  sending,
  onSend,
  onTyping,
  mentionCandidates = [],
  attachmentsEnabled = true,
  replyingTo,
  onCancelReply,
}: {
  /** The channel's name, or the other person's in a direct message. */
  placeName: string
  /** Only decides how the placeholder reads: a conversation has no hash. */
  placeKind?: 'channel' | 'conversation'
  disabled: boolean
  /** Shown in place of the field when sending is not allowed. */
  disabledReason?: string
  sending: boolean
  /** The files are already in the bucket; this hands over their metadata. */
  onSend: (body: string, attachments: readonly UploadedAttachment[]) => void
  onTyping: () => void
  /** Who may be mentioned here. Empty disables the menu entirely. */
  mentionCandidates?: readonly MentionCandidate[]
  attachmentsEnabled?: boolean
  /**
   * What is being replied to, if anything. The state belongs to the room
   * rather than to this component, which is what lets a reply be started,
   * cancelled and started again without the draft ever being touched.
   */
  replyingTo?: ReplyContext | null
  onCancelReply?: () => void
}) {
  const [draft, setDraft] = useState('')
  const [caret, setCaret] = useState(0)
  const [pending, setPending] = useState<Pending[]>([])
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** Where the caret goes once the emoji menu has finished closing. */
  const afterEmoji = useRef<number | null>(null)

  const uploading = pending.some((file) => file.status === 'uploading')
  const ready = pending.filter((file) => file.status === 'ready')

  async function pickFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return

    for (const file of Array.from(files)) {
      const rejection = rejectAttachment(file)
      // Refused here so nobody waits for an upload the bucket will refuse
      // anyway. The bucket is what actually enforces it.
      if (rejection) {
        toast.error(rejection.message)
        continue
      }

      const key = crypto.randomUUID()
      setPending((current) => [
        ...current,
        { key, name: file.name, size: file.size, status: 'uploading' },
      ])

      try {
        const upload = await attachmentService.upload(file)
        setPending((current) =>
          current.map((item) =>
            item.key === key ? { ...item, status: 'ready' as const, upload } : item,
          ),
        )
      } catch (error) {
        toast.error(errorMessage(error))
        setPending((current) =>
          current.map((item) => (item.key === key ? { ...item, status: 'failed' as const } : item)),
        )
      }
    }
  }

  function drop(key: string): void {
    setPending((current) => {
      const going = current.find((item) => item.key === key)
      // The object is the uploader's own until it is attached, so this is the
      // one moment it can be taken back.
      if (going?.upload) void attachmentService.discard([going.upload.storagePath])
      return current.filter((item) => item.key !== key)
    })
  }

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

  function insertEmoji(emoji: string): void {
    // Opening the menu takes the focus, so the caret is already forgotten by
    // the time a glyph is picked; the end of the draft is where it belongs.
    const at = caret >= 0 && caret <= draft.length ? caret : draft.length
    const next = `${draft.slice(0, at)}${emoji} ${draft.slice(at)}`
    if (next.length > MAX_LENGTH) return

    setDraft(next)
    const to = at + emoji.length + 1
    setCaret(to)
    afterEmoji.current = to
  }

  /** True once the caret is back in the field, which the menu needs to know. */
  function claimCaret(): boolean {
    const el = ref.current
    const to = afterEmoji.current
    afterEmoji.current = null
    // Dismissed without picking anything: the button should keep the focus.
    if (!el || to === null) return false

    el.focus()
    el.setSelectionRange(to, to)
    return true
  }

  // Starting a reply puts the caret in the field: the whole point is that the
  // answer is typed where everything else is typed. Keyed on the id rather
  // than the object, which is rebuilt on every render of the room.
  const replyingToId = replyingTo?.id ?? null
  useEffect(() => {
    if (replyingToId !== null) ref.current?.focus()
  }, [replyingToId])

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
    // A message is words: the database has said so since C1, with a length
    // check on the body. An attachment accompanies one rather than being one,
    // so there is always something to say. A file still on its way up is not
    // ready to be sent with anything.
    if (!body || disabled || sending || uploading) return

    onSend(
      body,
      ready
        .map((file) => file.upload)
        .filter((upload): upload is UploadedAttachment => Boolean(upload)),
    )
    setDraft('')
    setCaret(0)
    setPending([])
  }

  if (disabled) {
    return (
      <div className="px-4 pb-4 sm:px-5" role="group" aria-label={`Composer for ${placeName}`}>
        <p className="border-border text-muted-foreground text-2xs rounded-md border border-dashed px-3 py-2.5 text-center">
          {disabledReason ?? 'You do not have permission to send messages here.'}
        </p>
      </div>
    )
  }

  return (
    <div
      className="@container relative px-4 pb-3 sm:px-5 sm:pb-4"
      role="group"
      aria-label={`Composer for ${placeName}`}
    >
      {menuOpen ? (
        <div className="absolute inset-x-4 bottom-full sm:inset-x-5">
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
        // The bordered box, which is what a reader sees as the composer.
        data-composer-box=""
        className={cn(
          // L1 with a default border, and the border is the ring: focus moves
          // it to the accent's light tone rather than drawing a second line
          // outside it.
          'border-border bg-surface @container min-h-11 rounded-md border transition-[border-color] duration-[120ms]',
          'focus-within:border-accent-text',
        )}
      >
        {replyingTo && onCancelReply ? (
          <div
            className="border-border-subtle flex h-7 items-center gap-2 border-b px-2.5"
            aria-label="Replying to"
          >
            <ReplyContextLine context={replyingTo} className="min-w-0 flex-1" />
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground size-5 shrink-0"
              aria-label="Cancel reply"
              onClick={onCancelReply}
            >
              <X className="size-3" aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        {pending.length > 0 ? (
          <ul
            className="border-border-subtle flex flex-wrap gap-1.5 border-b px-2 py-2"
            aria-label="Attachments to send"
          >
            {pending.map((file) => (
              <li
                key={file.key}
                className={cn(
                  'border-border-subtle bg-elevated flex max-w-[240px] items-center gap-2 rounded-sm border px-2 py-1',
                  file.status === 'failed' && 'border-destructive/60',
                )}
              >
                {file.status === 'uploading' ? (
                  <SpinnerGap
                    className="text-muted-foreground size-3.5 shrink-0 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Paperclip
                    className="text-muted-foreground size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-xs leading-tight">{file.name}</span>
                  <span className="text-2xs text-muted-foreground block font-mono">
                    {file.status === 'uploading'
                      ? 'Uploading…'
                      : file.status === 'failed'
                        ? 'Upload failed'
                        : formatBytes(file.size)}
                  </span>
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground size-5 shrink-0"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => drop(file.key)}
                >
                  <X className="size-3" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <Textarea
          ref={ref}
          rows={1}
          value={draft}
          maxLength={MAX_LENGTH}
          placeholder={placeKind === 'channel' ? `Message #${placeName}` : `Message ${placeName}`}
          aria-label={`Message ${placeName}`}
          className="max-h-[168px] min-h-[38px] border-0 bg-transparent px-3 py-2.5 text-base focus-visible:border-0"
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

        <div className="flex items-center justify-end gap-2 px-2 pb-2">
          {draft.length > MAX_LENGTH - 200 ? (
            <span className="text-2xs text-muted-foreground shrink-0 font-mono tabular-nums">
              {String(MAX_LENGTH - draft.length)}
            </span>
          ) : null}

          {/* Emoji, then the paperclip, then send — the order a hand moves in,
              and the only place in the composer that holds an action. */}
          <div className="flex shrink-0 items-center gap-1">
            <ReactionPicker
              label="Add emoji"
              onPick={insertEmoji}
              className={ACTION_BUTTON}
              onClose={claimCaret}
              itemLabel={(emoji) => `Add ${emoji}`}
            />

            {attachmentsEnabled ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={ATTACHMENT_ACCEPT}
                  className="sr-only"
                  aria-label="Attach files"
                  onChange={(event) => {
                    void pickFiles(event.target.files)
                    // Cleared so choosing the same file twice in a row still
                    // fires a change.
                    event.target.value = ''
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(ACTION_BUTTON, 'text-muted-foreground hover:text-foreground')}
                  aria-label="Attach file"
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip aria-hidden="true" />
                </Button>
              </>
            ) : null}

            <Button
              variant="ghost"
              loading={sending}
              // Nothing said, or a file still on its way up.
              disabled={draft.trim().length === 0 || uploading}
              aria-label="Send message"
              // Ghost until there is something to send, and then the accent's
              // light tone — the only colour in the composer, and only when
              // pressing it would do something.
              className={cn(
                ACTION_BUTTON,
                'px-0',
                draft.trim().length === 0
                  ? 'text-muted-foreground'
                  : 'text-accent-text hover:text-accent-glow',
              )}
              onClick={submit}
            >
              {/* The spinner takes the icon's place rather than sitting beside
                  it: there is no label here for the pair to sit against. */}
              {sending ? null : <PaperPlaneTilt aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Under the composer rather than inside it: the box holds the message
          and its actions, and the courtesy sits below them. It hides itself
          where the box is too narrow to spare the line — the thread panel is
          288px and cannot hold both this and the actions. */}
      <p className="text-2xs text-muted-foreground/70 mt-1 px-1 font-mono @max-[320px]:hidden">
        <kbd className="font-mono">Enter</kbd> to send ·{' '}
        <kbd className="font-mono">Shift + Enter</kbd> for a new line
      </p>
    </div>
  )
}
