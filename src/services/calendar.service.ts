import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarRange,
  CalendarService,
} from './service-contracts'

export type { CalendarEvent, CalendarEventInput, CalendarRange } from './service-contracts'

/**
 * The organization's calendar.
 *
 * Reads go straight at the table under the caller's own JWT, so the
 * `calendar.view` policy is what decides what comes back — a member of another
 * organization gets zero rows rather than an error, and there is no filtering
 * here that a mistake could widen. Writes go through the SECURITY DEFINER
 * routines, as every protected write in this application does: the routine
 * checks the permission, normalises the times, and writes the audit entry, so
 * a client that skipped the service could not skip any of that.
 *
 * Times are instants both ways. The database stores `timestamptz`; this layer
 * hands ISO strings to the UI, which is what `Date` and `Intl` both take. The
 * zone an event was written in travels beside them rather than inside them.
 */

/** The columns a calendar screen needs, and nothing else. */
const FIELDS =
  'id, organization_id, title, description, location, starts_at, ends_at, all_day, timezone, event_type, created_by, reminder_minutes, created_at, updated_at'

interface Row {
  id: string
  organization_id: string
  title: string
  description: string | null
  location: string | null
  starts_at: string
  ends_at: string
  all_day: boolean
  timezone: string
  event_type: CalendarEvent['eventType']
  created_by: string | null
  reminder_minutes: number | null
  created_at: string
  updated_at: string
}

function toEvent(row: Row): CalendarEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    timezone: row.timezone,
    eventType: row.event_type,
    createdBy: row.created_by,
    reminderMinutes: row.reminder_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Two instants, in the order a window needs them.
 *
 * Rejected here rather than sent: a reversed range is a bug in the caller, and
 * a query that quietly returns nothing hides it.
 */
function assertRange(range: CalendarRange): void {
  const from = Date.parse(range.from)
  const to = Date.parse(range.to)
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new AppError('validation', 'A calendar range needs two valid instants.')
  }
  if (to <= from) {
    throw new AppError('validation', 'A calendar range has to end after it starts.')
  }
}

export const supabaseCalendarService: CalendarService = {
  /**
   * Everything overlapping the window.
   *
   * Overlap, not containment: an event that began last week and ends tomorrow
   * belongs on this week's calendar. `starts_at < to and ends_at > from` is
   * the whole of it, and it is what both indexes are for.
   */
  async listRange(range: CalendarRange): Promise<CalendarEvent[]> {
    assertRange(range)

    const { data, error } = await getSupabase()
      .from('calendar_events')
      .select(FIELDS)
      .eq('organization_id', range.organizationId)
      .lt('starts_at', range.to)
      .gt('ends_at', range.from)
      .order('starts_at', { ascending: true })

    if (error) throw toAppError(error)
    return ((data ?? []) as Row[]).map(toEvent)
  },

  async create(input: CalendarEventInput): Promise<string> {
    const { data, error } = await getSupabase().rpc('create_calendar_event', {
      p_organization_id: input.organizationId,
      p_title: input.title,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_all_day: input.allDay ?? false,
      p_timezone: input.timezone ?? null,
      p_description: input.description ?? null,
      p_location: input.location ?? null,
      p_event_type: input.eventType ?? 'other',
      p_reminder_minutes: input.reminderMinutes ?? null,
    })

    if (error) throw toAppError(error)
    return data
  },

  /**
   * A partial update. Anything left out is left alone — including the
   * organization, which is not a parameter at all: an event cannot change
   * hands, and the database refuses it even if something tried.
   */
  async update(eventId: string, input: Partial<CalendarEventInput>): Promise<void> {
    const { error } = await getSupabase().rpc('update_calendar_event', {
      p_event_id: eventId,
      p_title: input.title ?? null,
      p_starts_at: input.startsAt ?? null,
      p_ends_at: input.endsAt ?? null,
      p_all_day: input.allDay ?? null,
      p_timezone: input.timezone ?? null,
      p_description: input.description ?? null,
      p_location: input.location ?? null,
      p_event_type: input.eventType ?? null,
      // Three states, two of which look alike in JavaScript: a key that is not
      // there leaves the reminder alone, and an explicit null removes it. The
      // routine reads -1 as "remove", which is the integer equivalent of the
      // empty string that clears a description.
      p_reminder_minutes:
        input.reminderMinutes === undefined ? null : (input.reminderMinutes ?? -1),
    })

    if (error) throw toAppError(error)
  },

  async remove(eventId: string): Promise<void> {
    const { error } = await getSupabase().rpc('delete_calendar_event', { p_event_id: eventId })
    if (error) throw toAppError(error)
  },
}

/**
 * Demo mode has no calendar.
 *
 * The demo backend is an in-memory store with seeded channels and people; it
 * has no events, and inventing some would be showing fictional scrims as
 * though they were scheduled. Reads are empty and writes say why, rather than
 * a demo session reaching a real database it has no session for.
 */
const DEMO_MESSAGE = 'The calendar is not part of demo mode.'

const demoCalendarService: CalendarService = {
  listRange: () => Promise.resolve([]),
  create: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  update: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  remove: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
}

function impl(): CalendarService {
  return isDemoSessionActive() ? demoCalendarService : supabaseCalendarService
}

export const calendarService: CalendarService = {
  listRange: (range) => impl().listRange(range),
  create: (input) => impl().create(input),
  update: (eventId, input) => impl().update(eventId, input),
  remove: (eventId) => impl().remove(eventId),
}
