import { useEffect, useRef, useState } from 'react'
import { Paperclip, PaperPlaneTilt, SpinnerGap, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { MentionCandidate } from '@/services/channel.service'
import { attachmentService } from '@/services/attachment.service'
import type { UploadedAttachment } from '@/services/attachment.service'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { MentionAutocomplete } from './MentionAutocomplete'
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
}) {
  const [draft, setDraft] = useState('')
  const [caret, setCaret] = useState(0)
  const [pending, setPending] = useState<Pending[]>([])
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

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
      <div className="px-4 pb-4" role="group" aria-label={`Composer for ${placeName}`}>
        <p className="border-border text-muted-foreground text-2xs rounded-md border border-dashed px-3 py-2.5 text-center">
          {disabledReason ?? 'You do not have permission to send messages here.'}
        </p>
      </div>
    )
  }

  return (
    <div className="relative px-4 pb-3" role="group" aria-label={`Composer for ${placeName}`}>
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
        {pending.length > 0 ? (
          <ul
            className="border-border flex flex-wrap gap-1.5 border-b px-2 py-2"
            aria-label="Attachments to send"
          >
            {pending.map((file) => (
              <li
                key={file.key}
                className={cn(
                  'border-border bg-surface/60 flex max-w-[240px] items-center gap-2 rounded-sm border px-2 py-1',
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
                  <span className="text-3xs text-muted-foreground block">
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
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground size-7 shrink-0"
                aria-label="Attach a file"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="size-4" aria-hidden="true" />
              </Button>
            </>
          ) : null}
          <p className="text-3xs text-muted-foreground/60 flex-1 pl-1">
            <kbd className="font-sans font-medium">Enter</kbd> to send ·{' '}
            <kbd className="font-sans font-medium">Shift + Enter</kbd> for a new line
          </p>
          {draft.length > MAX_LENGTH - 200 ? (
            <span className="text-3xs text-muted-foreground tabular-nums">
              {String(MAX_LENGTH - draft.length)}
            </span>
          ) : null}
          <Button
            size="sm"
            loading={sending}
            // Nothing said, or a file still on its way up.
            disabled={draft.trim().length === 0 || uploading}
            onClick={submit}
          >
            <PaperPlaneTilt className="size-3.5" aria-hidden="true" />
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
