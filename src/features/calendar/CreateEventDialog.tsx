import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { calendarService } from '@/services/calendar.service'
import { queryKeys } from '@/lib/query-keys'
import type { DayKey } from './calendar-time'
import { defaultsFor, eventFormSchema, toEventInput, type EventFormValues } from './event-form'
import { EventFormFields } from './EventFormFields'
import { FormFailure } from './FormFailure'

/**
 * Scheduling something.
 *
 * The whole of the authorization is elsewhere: this dialog only opens for
 * somebody the permission set says holds `calendar.create`, and the routine
 * behind `calendarService.create` asks Postgres the same question again with
 * the caller's own JWT. Hiding the button is a courtesy; the refusal is the
 * control.
 *
 * The zone is a field rather than an assumption. A form filled in on a laptop
 * in Berlin can schedule 20:00 in Jakarta, and the three inputs — date, clock,
 * zone — only become an instant at the moment of submission.
 */
export function CreateEventDialog({
  open,
  onOpenChange,
  organizationId,
  day,
  timezone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  /** The day the calendar is looking at, which is where this lands. */
  day: DayKey
  /** The zone the calendar is being read in, and the form's default. */
  timezone: string
}) {
  const queryClient = useQueryClient()

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: defaultsFor(day, timezone),
  })

  // Opening on a different day fills in that day. Reset rather than remount so
  // the dialog's own animation is not interrupted.
  useEffect(() => {
    if (open) form.reset(defaultsFor(day, timezone))
    // `form` is stable; resetting on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day, timezone])

  const mutation = useMutation({
    mutationFn: (values: EventFormValues) =>
      calendarService.create(toEventInput(values, organizationId)),
    onSuccess: async () => {
      toast.success('Event created.')
      // Only the calendar: every window of this organization's diary is stale,
      // and nothing else in the application is.
      await queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all(organizationId) })
      onOpenChange(false)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (mutation.isPending) return
        mutation.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="top-3 flex max-h-[92dvh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-1/2 sm:max-h-[88dvh] sm:max-w-lg sm:-translate-y-1/2">
        <div className="border-border-subtle shrink-0 border-b px-5 py-4">
          <p className="display-eyebrow text-3xs text-muted-foreground">Schedule</p>
          <DialogTitle className="mt-1 text-[15px]">Create event</DialogTitle>
          <DialogDescription className="mt-1">
            Everybody in this organization who can see the calendar will see it.
          </DialogDescription>
        </div>

        <form
          id="create-event"
          noValidate
          onSubmit={form.handleSubmit((values) => {
            mutation.mutate(values)
          })}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          <FormFailure error={mutation.isError ? mutation.error : null} />
          <EventFormFields form={form} timezone={timezone} autoFocus />
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
          <Button type="submit" form="create-event" loading={mutation.isPending}>
            Create event
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
