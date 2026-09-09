import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/common/FormField'
import { FormFailure } from '@/components/common/FormFailure'
import type { useProjectLifecycle } from './use-projects'
import {
  NO_REVIEW_LIMIT,
  REVIEW_DURATIONS,
  durationFromValue,
  valueFromDuration,
} from './project-status'

/**
 * Sending a project to review, and saying how long the review runs.
 *
 * The length is a choice from a short list rather than a number in a box:
 * these are the lengths people pick, and an open field is mostly a way to
 * write an unreadable deadline. `assert_valid_review_duration` holds the same
 * list, so a request that came from somewhere other than this dialog is
 * refused rather than quietly honoured.
 *
 * What is sent is the length, never the deadline. The instant is computed by
 * the routine from the server's clock — a timestamp from here would be a
 * deadline the person waiting for it could choose.
 */
export function SendToReviewDialog({
  open,
  onOpenChange,
  lifecycle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lifecycle: ReturnType<typeof useProjectLifecycle>
}) {
  const [duration, setDuration] = useState<string>(valueFromDuration(1440))
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
          <DialogTitle className="text-[15px]">Send to review?</DialogTitle>
          <DialogDescription className="mt-1">
            The project moves to review and stays there until the period ends.
          </DialogDescription>
        </div>

        <div className="space-y-3 px-5 py-4">
          <FormField label="Review period" hint="The deadline is set by the server when you send it.">
            {(props) => (
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REVIEW_DURATIONS.map((option) => (
                    <SelectItem
                      key={option.minutes ?? NO_REVIEW_LIMIT}
                      value={valueFromDuration(option.minutes)}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

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
                  {
                    target: 'in_review',
                    reviewDurationMinutes: durationFromValue(duration),
                  },
                  {
                    onSuccess: () => {
                      toast.success('Sent to review.')
                      onOpenChange(false)
                    },
                  },
                )
              }}
            >
              Send to review
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
