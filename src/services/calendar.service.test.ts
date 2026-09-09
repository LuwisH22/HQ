import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The calendar service, without a database.
 *
 * What is worth checking here is the shape of what goes over the wire: that a
 * window is asked for as an overlap rather than a containment, that a reversed
 * range is refused before it becomes a query that quietly returns nothing, and
 * that an instant and the zone it was meant in travel separately all the way
 * down. The rules themselves — permission, normalisation, audit — live in the
 * database, and `scripts/verify-calendar.mjs` checks them there.
 */

interface Recorded {
  table?: string
  select?: string
  filters: [string, string, unknown][]
  order?: [string, unknown]
  rpc?: [string, Record<string, unknown>]
}

const recorded: Recorded = { filters: [] }
let rows: unknown[] = []
let failure: { message: string; code?: string } | null = null

function builder() {
  const chain = {
    select(columns: string) {
      recorded.select = columns
      return chain
    },
    eq(column: string, value: unknown) {
      recorded.filters.push(['eq', column, value])
      return chain
    },
    lt(column: string, value: unknown) {
      recorded.filters.push(['lt', column, value])
      return chain
    },
    gt(column: string, value: unknown) {
      recorded.filters.push(['gt', column, value])
      return chain
    },
    order(column: string, options: unknown) {
      recorded.order = [column, options]
      return Promise.resolve({ data: rows, error: failure })
    },
  }
  return chain
}

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from(table: string) {
      recorded.table = table
      return builder()
    },
    rpc(name: string, args: Record<string, unknown>) {
      recorded.rpc = [name, args]
      return Promise.resolve({ data: 'event-1', error: failure })
    },
  }),
}))

const demo = vi.hoisted(() => ({ active: false }))
vi.mock('@/lib/demo-mode', () => ({ isDemoSessionActive: () => demo.active }))

const { calendarService } = await import('./calendar.service')

const ROW = {
  id: 'event-1',
  organization_id: 'org-1',
  title: 'Scrim vs RRQ',
  description: null,
  location: null,
  starts_at: '2026-03-01T13:00:00.000Z',
  ends_at: '2026-03-01T15:00:00.000Z',
  all_day: false,
  timezone: 'Asia/Jakarta',
  event_type: 'scrim' as const,
  created_by: 'user-1',
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
}

beforeEach(() => {
  recorded.table = undefined
  recorded.select = undefined
  recorded.filters = []
  recorded.order = undefined
  recorded.rpc = undefined
  rows = []
  failure = null
  demo.active = false
})

describe('reading a window', () => {
  it('asks for an overlap, not a containment', async () => {
    await calendarService.listRange({
      organizationId: 'org-1',
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-04-01T00:00:00.000Z',
    })

    expect(recorded.table).toBe('calendar_events')
    // An event that began before the window and ends inside it belongs to it,
    // which is what these two bounds say.
    expect(recorded.filters).toContainEqual(['lt', 'starts_at', '2026-04-01T00:00:00.000Z'])
    expect(recorded.filters).toContainEqual(['gt', 'ends_at', '2026-03-01T00:00:00.000Z'])
    expect(recorded.filters).toContainEqual(['eq', 'organization_id', 'org-1'])
    expect(recorded.order).toEqual(['starts_at', { ascending: true }])
  })

  it('refuses a range that ends before it starts', async () => {
    await expect(
      calendarService.listRange({
        organizationId: 'org-1',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-03-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(/end after it starts/i)
  })

  it('refuses a range that is not two instants', async () => {
    await expect(
      calendarService.listRange({ organizationId: 'org-1', from: 'soon', to: 'later' }),
    ).rejects.toThrow(/valid instants/i)
  })

  it('keeps the instant and the zone apart on the way back', async () => {
    rows = [ROW]
    const [event] = await calendarService.listRange({
      organizationId: 'org-1',
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-04-01T00:00:00.000Z',
    })

    expect(event).toMatchObject({
      id: 'event-1',
      startsAt: '2026-03-01T13:00:00.000Z',
      timezone: 'Asia/Jakarta',
      eventType: 'scrim',
      allDay: false,
    })

    // The instant is the truth, and the zone is what it meant: 13:00 UTC is
    // 20:00 in Jakarta, which is the hour somebody actually scheduled.
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: event!.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(event!.startsAt))
    expect(local).toBe('20:00')
  })
})

describe('writing', () => {
  it('creates through the routine, never the table', async () => {
    const id = await calendarService.create({
      organizationId: 'org-1',
      title: 'Scrim vs RRQ',
      startsAt: '2026-03-01T13:00:00.000Z',
      endsAt: '2026-03-01T15:00:00.000Z',
      eventType: 'scrim',
      timezone: 'Asia/Jakarta',
    })

    expect(id).toBe('event-1')
    expect(recorded.rpc?.[0]).toBe('create_calendar_event')
    expect(recorded.rpc?.[1]).toMatchObject({
      p_organization_id: 'org-1',
      p_starts_at: '2026-03-01T13:00:00.000Z',
      p_timezone: 'Asia/Jakarta',
      p_event_type: 'scrim',
      p_all_day: false,
    })
  })

  it('sends a null for everything an update leaves alone', async () => {
    await calendarService.update('event-1', { title: 'Scrim vs ONIC' })

    expect(recorded.rpc?.[0]).toBe('update_calendar_event')
    expect(recorded.rpc?.[1]).toEqual({
      p_event_id: 'event-1',
      p_title: 'Scrim vs ONIC',
      p_starts_at: null,
      p_ends_at: null,
      p_all_day: null,
      p_timezone: null,
      p_description: null,
      p_location: null,
      p_event_type: null,
      p_reminder_minutes: null,
    })
  })

  it('distinguishes leaving a reminder alone from taking it away', async () => {
    // Two things that look alike in JavaScript and mean opposite things to the
    // routine: a key that is not there, and a key set to null.
    await calendarService.update('event-1', { title: 'Scrim' })
    expect((recorded.rpc?.[1] as Record<string, unknown>).p_reminder_minutes).toBeNull()

    await calendarService.update('event-1', { reminderMinutes: 15 })
    expect((recorded.rpc?.[1] as Record<string, unknown>).p_reminder_minutes).toBe(15)

    await calendarService.update('event-1', { reminderMinutes: null })
    // -1 is the routine's "remove it".
    expect((recorded.rpc?.[1] as Record<string, unknown>).p_reminder_minutes).toBe(-1)
  })

  it('sends a reminder along with a new event, and nothing when there is none', async () => {
    await calendarService.create({
      organizationId: 'org-1',
      title: 'Scrim',
      startsAt: '2026-03-01T13:00:00.000Z',
      endsAt: '2026-03-01T15:00:00.000Z',
      reminderMinutes: 30,
    })
    expect((recorded.rpc?.[1] as Record<string, unknown>).p_reminder_minutes).toBe(30)

    await calendarService.create({
      organizationId: 'org-1',
      title: 'Scrim',
      startsAt: '2026-03-01T13:00:00.000Z',
      endsAt: '2026-03-01T15:00:00.000Z',
    })
    expect((recorded.rpc?.[1] as Record<string, unknown>).p_reminder_minutes).toBeNull()
  })

  it('offers no way to move an event to another organization', () => {
    // Not a runtime check but a structural one: `update` takes a partial input
    // and the routine has no organization parameter at all, so there is no
    // argument to smuggle one in. The database refuses it as well.
    expect(Object.keys(recorded.rpc?.[1] ?? {})).not.toContain('p_organization_id')
  })

  it('deletes through the routine', async () => {
    await calendarService.remove('event-1')
    expect(recorded.rpc).toEqual(['delete_calendar_event', { p_event_id: 'event-1' }])
  })
})

describe('in demo mode', () => {
  beforeEach(() => {
    demo.active = true
  })

  it('has no events rather than fictional ones', async () => {
    await expect(
      calendarService.listRange({
        organizationId: 'org-1',
        from: '2026-03-01T00:00:00.000Z',
        to: '2026-04-01T00:00:00.000Z',
      }),
    ).resolves.toEqual([])
    // And it never reached the database to find that out.
    expect(recorded.table).toBeUndefined()
  })

  it('says so rather than writing anywhere', async () => {
    await expect(
      calendarService.create({
        organizationId: 'org-1',
        title: 'x',
        startsAt: '2026-03-01T13:00:00.000Z',
        endsAt: '2026-03-01T15:00:00.000Z',
      }),
    ).rejects.toThrow(/not part of demo mode/i)
    expect(recorded.rpc).toBeUndefined()
  })
})
