import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { calendarService, type CalendarEvent } from '@/services/calendar.service'
import { AppError } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { EVENT_TYPE_LABELS } from './event-types'
import { FormFailure } from './FormFailure'

/**
 * Taking an event off the calendar.
 *
 * A confirmation because it is permanent — Phase 5.1 deletes the row rather
 * than tombstoning it, and the audit entry is what remains. The event is named
 * here so the confirmation is about a particular thing rather than about the
 * word "delete".
 *
 * The routine decides who may, exactly as it does for editing. A failure keeps
 * this dialog open with the reason on it, because a deletion that quietly does
 * nothing is worse than one that refuses out loud.
 */
export function DeleteEventDialog({
  event,
  onOpenChange,
  onDeleted,
}: {
  event: CalendarEvent | null
  onOpenChange: (open: boolean) => void
  /** Closes whatever was showing the event, which no longer exists. */
  onDeleted: () => void
}) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => {
      if (!event) throw new Error('No event to delete')
      return calendarService.remove(event.id)
    },
    onSuccess: async () => {
      toast.success('Event deleted.')
      await queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.all(event?.organizationId ?? 'none'),
      })
      onOpenChange(false)
      onDeleted()
    },
    onError: (error) => {
      // Somebody else removed it first. The confirmation stays up saying so,
      // and the calendar behind it stops showing an event that is not there.
      if (error instanceof AppError && error.kind === 'not_found') {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.calendar.all(event?.organizationId ?? 'none'),
        })
      }
    },
  })

  return (
    <Dialog
      open={event !== null}
      onOpenChange={(next) => {
        if (mutation.isPending) return
        mutation.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <div className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">Delete event?</DialogTitle>
          <DialogDescription className="mt-1">This cannot be undone.</DialogDescription>
        </div>

        {event ? (
          <div className="border-border-subtle bg-background border-y px-5 py-3">
            <p className="display-eyebrow text-3xs text-muted-foreground">
              {EVENT_TYPE_LABELS[event.eventType]}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold">{event.title}</p>
          </div>
        ) : null}

        <div className="space-y-3 px-5 py-4">
          <FormFailure error={mutation.isError ? mutation.error : null} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => {
                onOpenChange(false)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="border-destructive/60 border"
              loading={mutation.isPending}
              onClick={() => {
                mutation.mutate()
              }}
            >
              Delete event
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
