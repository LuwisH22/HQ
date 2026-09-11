import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { FormFailure } from '@/components/common/FormFailure'
import { cn } from '@/lib/utils'

/**
 * A confirmation that does not leave the panel.
 *
 * The audit's replacement for the delete and discard dialogs: a strip that
 * opens beneath the panel's footer, says what is about to happen to which
 * thing, and offers the two answers. Nothing is covered and nothing is
 * trapped — the event, or the form, stays visible above it — which is what
 * makes deleting feel safe without a modal.
 *
 * It opens by animating its grid row from nothing to its content's height,
 * takes focus onto Cancel so the safe answer is the one under the keyboard,
 * and is inert while closed so its buttons cannot be tabbed into.
 */
export function ConfirmStrip({
  open,
  tone,
  title,
  description,
  cancelLabel,
  confirmLabel,
  confirming = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  open: boolean
  /** Deleting is red; abandoning typing is amber. */
  tone: 'danger' | 'warning'
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  confirming?: boolean
  error?: unknown
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    // After the row has begun to open, so the browser does not scroll a
    // zero-height element into view.
    const id = window.setTimeout(() => cancelRef.current?.focus(), 60)
    return () => window.clearTimeout(id)
  }, [open])

  return (
    <div
      inert={!open}
      aria-hidden={!open}
      className={cn(
        'grid transition-[grid-template-rows] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
    >
      <div className="overflow-hidden">
        <div
          className={cn(
            'border-border-subtle space-y-2 border-t px-5 py-3',
            tone === 'danger' ? 'bg-destructive/6' : 'bg-warning/6',
          )}
        >
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-muted-foreground text-xs">{description}</p>
          <FormFailure error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button
              ref={cancelRef}
              type="button"
              variant="ghost"
              size="sm"
              disabled={confirming}
              onClick={onCancel}
            >
              {cancelLabel}
            </Button>
            {tone === 'danger' ? (
              // The one solid destructive fill in the calendar, for the one
              // thing that cannot be undone.
              <Button
                type="button"
                variant="destructive"
                size="sm"
                loading={confirming}
                className="bg-[var(--destructive-fill)] text-white hover:bg-[#d9453c] active:bg-[#b8332c]"
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={confirming}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
