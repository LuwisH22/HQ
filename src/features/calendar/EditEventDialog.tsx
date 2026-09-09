import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { calendarService, type CalendarEvent } from '@/services/calendar.service'
import { AppError } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import {
  defaultsFromEvent,
  eventFormSchema,
  toEventInput,
  type EventFormValues,
} from './event-form'
import { EventFormFields } from './EventFormFields'
import { FormFailure } from './FormFailure'

/**
 * Changing an event that already exists.
 *
 * The same fields, the same schema and the same conversion as creating one —
 * what differs is where the values come from and which routine is called. The
 * routine decides who may: `calendar.manage` edits anything, and the person
 * who created it edits their own while they still hold `calendar.create`.
 * This dialog only opens where that is already true of the reader, and the
 * database asks again.
 *
 * The form opens in the event's own zone. Editing a Jakarta scrim from Berlin
 * shows 20:00 Asia/Jakarta, so saving a change of title cannot quietly move
 * the event by seven hours.
 */
export function EditEventDialog({
  event,
  onOpenChange,
  timezone,
}: {
  /** The event being edited, or null when nothing is. */
  event: CalendarEvent | null
  onOpenChange: (open: boolean) => void
  /** The calendar's own zone, offered in the picker beside the curated few. */
  timezone: string
}) {
  const queryClient = useQueryClient()

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: event ? defaultsFromEvent(event) : { ...defaultsFromEvent(EMPTY), timezone },
  })

  useEffect(() => {
    if (event) form.reset(defaultsFromEvent(event))
    // `form` is stable; resetting on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, event?.updatedAt])

  const mutation = useMutation({
    mutationFn: (values: EventFormValues) => {
      if (!event) throw new Error('No event to update')
      // The organization is not a parameter: an event cannot change hands, and
      // the routine has nowhere to put one if it tried.
      const input = toEventInput(values, event.organizationId)
      return calendarService.update(event.id, input)
    },
    onSuccess: async () => {
      toast.success('Event updated.')
      await queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.all(event?.organizationId ?? 'none'),
      })
      onOpenChange(false)
    },
    onError: (error) => {
      // If it is gone, the calendar behind this form is showing something that
      // no longer exists. Ask again — the form stays open with the reason on
      // it, and closing it reveals a grid that has caught up.
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
      <DialogContent className="top-3 flex max-h-[92dvh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-1/2 sm:max-h-[88dvh] sm:max-w-lg sm:-translate-y-1/2">
        <div className="border-border-subtle shrink-0 border-b px-5 py-4">
          <p className="display-eyebrow text-3xs text-muted-foreground">Schedule</p>
          <DialogTitle className="mt-1 text-[15px]">Edit event</DialogTitle>
          <DialogDescription className="mt-1">
            Times are shown in the zone this event was written in.
          </DialogDescription>
        </div>

        <form
          id="edit-event"
          noValidate
          onSubmit={form.handleSubmit((values) => {
            mutation.mutate(values)
          })}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          <FormFailure error={mutation.isError ? mutation.error : null} />
          {event ? <EventFormFields form={form} timezone={timezone} /> : null}
        </form>

        <div className="border-border-subtle bg-elevated flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
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
            type="submit"
            form="edit-event"
            loading={mutation.isPending}
            disabled={!form.formState.isDirty}
          >
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A shape for the closed dialog's form, which nothing ever reads. */
const EMPTY = {
  title: '',
  eventType: 'other' as const,
  allDay: false,
  startsAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  timezone: 'UTC',
  location: null,
  description: null,
}
