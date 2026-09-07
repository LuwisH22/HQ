import { useQuery } from '@tanstack/react-query'
import { calendarService, type CalendarEvent } from '@/services/calendar.service'
import { queryKeys } from '@/lib/query-keys'
import type { InstantRange } from './calendar-time'

/**
 * The events in the window on screen, and no others.
 *
 * The range is part of the key, so moving to the next month is a new query
 * rather than a refetch of a growing list, and going back finds the previous
 * one already cached. Server state stays here in TanStack Query — the calendar
 * keeps only which day and which view it is showing.
 *
 * Nothing is filtered client-side: the `calendar.view` policy decides what
 * comes back, and a member without it gets an empty calendar rather than an
 * error.
 */
export function useCalendarEvents(organizationId: string | undefined, range: InstantRange) {
  const from = range.from.toISOString()
  const to = range.to.toISOString()

  return useQuery({
    queryKey: queryKeys.calendar.range(organizationId ?? 'none', from, to),
    queryFn: (): Promise<CalendarEvent[]> =>
      calendarService.listRange({ organizationId: organizationId as string, from, to }),
    enabled: Boolean(organizationId),
    // A calendar is not a chat: what is on it changes rarely, and a month
    // already fetched is worth keeping while somebody flicks back and forth.
    staleTime: 60_000,
  })
}
