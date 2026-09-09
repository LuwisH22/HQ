import { toast } from 'sonner'
import { Warning } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormFailure } from '@/components/common/FormFailure'
import type { useProjectLifecycle } from './use-projects'

/**
 * Finishing a project.
 *
 * Two things are checked before this is possible, and neither of them is
 * checked here. The review deadline is re-read by the routine from the row, so
 * a countdown that has run out on one screen and not another cannot bring a
 * completion forward. And work still open is refused unless the caller says
 * out loud that it should be — this dialog is what says it, after showing how
 * much there is.
 *
 * Which is the point of asking rather than hiding: a project can genuinely be
 * finished with tasks left on the board, and the honest version of that is a
 * sentence saying how many rather than a silent completion.
 */
export function CompleteProjectDialog({
  open,
  onOpenChange,
  lifecycle,
  unfinished,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lifecycle: ReturnType<typeof useProjectLifecycle>
  /** Tasks on the board that are not done. */
  unfinished: number
}) {
  const { move } = lifecycle

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (move.isPending) return
        move.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">Mark as done?</DialogTitle>
          <DialogDescription className="mt-1">
            The review period has ended. This is the last stage — a finished project does not go
            back.
          </DialogDescription>
        </div>

        {unfinished > 0 ? (
          <div className="border-border-subtle bg-background text-muted-foreground border-y px-5 py-3">
            <p className="text-2xs flex items-start gap-2">
              <Warning aria-hidden="true" className="text-brass mt-px size-3.5 shrink-0" />
              <span>
                <strong className="text-foreground font-medium">
                  {`${String(unfinished)} task${unfinished === 1 ? ' is' : 's are'} not complete.`}
                </strong>{' '}
                They stay on the board exactly as they are.
              </span>
            </p>
          </div>
        ) : null}

        <div className="space-y-3 px-5 py-4">
          <FormFailure error={move.isError ? move.error : null} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={move.isPending}
              onClick={() => {
                onOpenChange(false)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={move.isPending}
              onClick={() => {
                move.mutate(
                  // Said out loud, and only because the dialog above has just
                  // shown what it means.
                  { target: 'done', allowUnfinished: unfinished > 0 },
                  {
                    onSuccess: () => {
                      toast.success('Project completed.')
                      onOpenChange(false)
                    },
                  },
                )
              }}
            >
              {unfinished > 0 ? 'Complete anyway' : 'Mark as done'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
