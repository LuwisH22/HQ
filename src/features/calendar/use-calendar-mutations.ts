import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { calendarService, type CalendarEvent } from '@/services/calendar.service'
import { AppError } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { toEventInput, type EventFormValues } from './event-form'

/**
 * The three writes a calendar makes, and what the cache does about them.
 *
 * Authorization is elsewhere: the panel only offers these where the
 * permission set says it may, and the routine behind each call asks Postgres
 * the same question again with the caller's own JWT. Hiding the button is a
 * courtesy; the refusal is the control.
 *
 * After an edit or a deletion the cached windows are patched in the same
 * frame — the row moves or goes before the round trip that confirms it —
 * and then the organization's calendar family is invalidated so the server's
 * version replaces the guess. A creation waits for the refetch instead: the
 * panel needs the real row, and inventing one to show for a hundred
 * milliseconds is how a calendar ends up with two.
 */
export function useCalendarMutations(organizationId: string | undefined) {
  const queryClient = useQueryClient()
  const family = queryKeys.calendar.all(organizationId ?? 'none')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: family })

  /** Every cached window, patched by one function. */
  const patch = (fn: (events: CalendarEvent[]) => CalendarEvent[]) => {
    queryClient.setQueriesData<CalendarEvent[]>({ queryKey: family }, (events) =>
      events ? fn(events) : events,
    )
  }

  /** Gone under us: the calendar behind the panel is showing something that no longer exists. */
  const dropIfMissing = (error: unknown) => {
    if (error instanceof AppError && error.kind === 'not_found') void invalidate()
  }

  const create = useMutation({
    mutationFn: (values: EventFormValues) => {
      if (!organizationId) throw new AppError('validation', 'No organization is selected.')
      return calendarService.create(toEventInput(values, organizationId))
    },
    onSuccess: async () => {
      toast.success('Event created.')
      await invalidate()
    },
  })

  const update = useMutation({
    mutationFn: ({ event, values }: { event: CalendarEvent; values: EventFormValues }) => {
      // The organization is not a parameter: an event cannot change hands.
      const input = toEventInput(values, event.organizationId)
      return calendarService.update(event.id, input).then(() => ({ event, input }))
    },
    onSuccess: async ({ event, input }) => {
      patch((events) =>
        events.map((row) =>
          row.id === event.id
            ? {
                ...row,
                title: input.title,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                allDay: input.allDay ?? row.allDay,
                timezone: input.timezone ?? row.timezone,
                eventType: input.eventType ?? row.eventType,
                location: input.location ?? null,
                description: input.description ?? null,
                reminderMinutes: input.reminderMinutes ?? null,
              }
            : row,
        ),
      )
      toast.success('Event updated.')
      await invalidate()
    },
    onError: dropIfMissing,
  })

  const remove = useMutation({
    mutationFn: (event: CalendarEvent) => calendarService.remove(event.id).then(() => event),
    onSuccess: async (event) => {
      patch((events) => events.filter((row) => row.id !== event.id))
      toast.success('Event deleted.')
      await invalidate()
    },
    onError: dropIfMissing,
  })

  return { create, update, remove }
}
