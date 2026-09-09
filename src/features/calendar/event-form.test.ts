import { describe, expect, it } from 'vitest'
import {
  defaultsFor,
  defaultsFromEvent,
  eventFormSchema,
  REMINDER_VALUES,
  reminderMinutesOf,
  reminderValueOf,
  toEventInput,
  todayIn,
  type EventFormValues,
} from './event-form'

/**
 * What a person types, checked before it becomes an instant.
 *
 * Every rule here is also a CHECK constraint or a routine's refusal in
 * Postgres, so these tests are about the message arriving early rather than
 * about the database being protected — it protects itself. The parts worth
 * the most attention are the two conversions: a date, a clock and a zone
 * becoming one moment, and a run of days becoming a half-open range.
 */

const JAKARTA = 'Asia/Jakarta'

function values(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return { ...defaultsFor('2026-03-05', JAKARTA), ...overrides }
}

describe('a timed event', () => {
  it('accepts an ordinary one', () => {
    const parsed = eventFormSchema.safeParse(values({ title: 'Scrim vs RRQ' }))
    expect(parsed.success).toBe(true)
  })

  it('becomes the instant its three fields name together', () => {
    const input = toEventInput(
      values({ title: 'Scrim vs RRQ', startTime: '20:00', endTime: '22:00' }),
      'org-1',
    )
    // 20:00 in Jakarta is 13:00 UTC, whatever zone the browser is in.
    expect(input.startsAt).toBe('2026-03-05T13:00:00.000Z')
    expect(input.endsAt).toBe('2026-03-05T15:00:00.000Z')
    expect(input.timezone).toBe(JAKARTA)
    expect(input.allDay).toBe(false)
  })

  it('is refused when it ends before it starts', () => {
    const parsed = eventFormSchema.safeParse(
      values({ title: 'Backwards', startTime: '20:00', endTime: '19:00' }),
    )
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toMatch(/end after it starts/i)
  })

  it('is refused when it has no length at all', () => {
    const parsed = eventFormSchema.safeParse(
      values({ title: 'Instant', startTime: '20:00', endTime: '20:00' }),
    )
    expect(parsed.success).toBe(false)
  })

  it('accepts one that crosses midnight into the next day', () => {
    const parsed = eventFormSchema.safeParse(
      values({
        title: 'Late block',
        startTime: '23:00',
        endDate: '2026-03-06',
        endTime: '01:00',
      }),
    )
    expect(parsed.success).toBe(true)
  })
})

describe('an all-day event', () => {
  it('is midnight to the following midnight in its own zone', () => {
    const input = toEventInput(values({ title: 'Bootcamp', allDay: true }), 'org-1')

    // Jakarta is seven hours ahead, so its midnight is 17:00 UTC the day
    // before — and the end is exclusive.
    expect(input.startsAt).toBe('2026-03-04T17:00:00.000Z')
    expect(input.endsAt).toBe('2026-03-05T17:00:00.000Z')
    expect(input.allDay).toBe(true)
    // Exactly one day long, in its own zone.
    expect(Date.parse(input.endsAt) - Date.parse(input.startsAt)).toBe(24 * 60 * 60 * 1000)
  })

  it('covers every day of a run, end exclusive', () => {
    const input = toEventInput(
      values({ title: 'Bootcamp', allDay: true, endDate: '2026-03-07' }),
      'org-1',
    )
    expect(input.startsAt).toBe('2026-03-04T17:00:00.000Z')
    expect(input.endsAt).toBe('2026-03-07T17:00:00.000Z')
    expect(Date.parse(input.endsAt) - Date.parse(input.startsAt)).toBe(3 * 24 * 60 * 60 * 1000)
  })

  it('is not a 00:00 timed event', () => {
    const input = toEventInput(values({ title: 'Bootcamp', allDay: true }), 'org-1')
    expect(input.allDay).toBe(true)
  })

  it('ignores the clock fields entirely', () => {
    const withTimes = toEventInput(
      values({ title: 'Bootcamp', allDay: true, startTime: '20:00', endTime: '04:00' }),
      'org-1',
    )
    const without = toEventInput(values({ title: 'Bootcamp', allDay: true }), 'org-1')
    expect(withTimes.startsAt).toBe(without.startsAt)
    expect(withTimes.endsAt).toBe(without.endsAt)
  })

  it('is refused when the last day is before the first', () => {
    const parsed = eventFormSchema.safeParse(
      values({ title: 'Backwards', allDay: true, endDate: '2026-03-04' }),
    )
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toMatch(/before the first/i)
  })

  it('accepts a single day, where start and end are the same date', () => {
    const parsed = eventFormSchema.safeParse(values({ title: 'One day', allDay: true }))
    expect(parsed.success).toBe(true)
  })
})

describe('the fields', () => {
  it('trims the title and refuses one made only of spaces', () => {
    const parsed = eventFormSchema.safeParse(values({ title: '   Scrim   ' }))
    expect(parsed.success).toBe(true)
    expect(parsed.data?.title).toBe('Scrim')

    expect(eventFormSchema.safeParse(values({ title: '' })).success).toBe(false)
    expect(eventFormSchema.safeParse(values({ title: '    ' })).success).toBe(false)
  })

  it('holds the title to the length the database does', () => {
    expect(eventFormSchema.safeParse(values({ title: 'a'.repeat(120) })).success).toBe(true)
    expect(eventFormSchema.safeParse(values({ title: 'a'.repeat(121) })).success).toBe(false)
  })

  it('holds the description and the location to theirs', () => {
    expect(
      eventFormSchema.safeParse(values({ title: 'x', description: 'd'.repeat(2000) })).success,
    ).toBe(true)
    expect(
      eventFormSchema.safeParse(values({ title: 'x', description: 'd'.repeat(2001) })).success,
    ).toBe(false)
    expect(
      eventFormSchema.safeParse(values({ title: 'x', location: 'l'.repeat(200) })).success,
    ).toBe(true)
    expect(
      eventFormSchema.safeParse(values({ title: 'x', location: 'l'.repeat(201) })).success,
    ).toBe(false)
  })

  it('sends nothing rather than an empty string for what was left blank', () => {
    const input = toEventInput(values({ title: 'Scrim', location: '  ', description: '' }), 'org-1')
    expect(input.location).toBeNull()
    expect(input.description).toBeNull()
  })

  it('takes only the seven categories the schema has', () => {
    for (const type of ['match', 'scrim', 'practice', 'meeting', 'content', 'event', 'other']) {
      expect(
        eventFormSchema.safeParse(values({ title: 'x', eventType: type as 'match' })).success,
      ).toBe(true)
    }
    expect(
      eventFormSchema.safeParse(values({ title: 'x', eventType: 'admin' as 'match' })).success,
    ).toBe(false)
  })

  it('refuses a date or a clock it cannot read', () => {
    expect(eventFormSchema.safeParse(values({ title: 'x', startDate: '5 March' })).success).toBe(
      false,
    )
    expect(eventFormSchema.safeParse(values({ title: 'x', startTime: '25:00' })).success).toBe(
      false,
    )
    expect(eventFormSchema.safeParse(values({ title: 'x', startTime: '9am' })).success).toBe(false)
  })

  it('refuses an empty timezone', () => {
    expect(eventFormSchema.safeParse(values({ title: 'x', timezone: '' })).success).toBe(false)
  })
})

describe('what the form opens with', () => {
  it('is the day the calendar is looking at, not today', () => {
    const form = defaultsFor('2026-07-19', JAKARTA)
    expect(form.startDate).toBe('2026-07-19')
    expect(form.endDate).toBe('2026-07-19')
    expect(form.timezone).toBe(JAKARTA)
    expect(form.allDay).toBe(false)
  })

  it('is an hour long, with no business-hour cleverness', () => {
    const form = defaultsFor('2026-07-19', JAKARTA)
    expect(form.startTime).toBe('09:00')
    expect(form.endTime).toBe('10:00')

    const input = toEventInput({ ...form, title: 'Meeting' }, 'org-1')
    expect(Date.parse(input.endsAt) - Date.parse(input.startsAt)).toBe(60 * 60 * 1000)
  })

  it('knows what day it is where the reader is', () => {
    const instant = new Date('2026-03-01T16:30:00.000Z')
    expect(todayIn(JAKARTA, instant)).toBe('2026-03-01')
    expect(todayIn('Pacific/Auckland', instant)).toBe('2026-03-02')
  })
})

describe('the organization', () => {
  it('comes from the caller rather than from the form', () => {
    const input = toEventInput(values({ title: 'Scrim' }), 'org-42')
    expect(input.organizationId).toBe('org-42')
    // There is no field for it, so there is nothing in the form to tamper
    // with — and the routine checks the permission against it regardless.
    expect(Object.keys(values())).not.toContain('organizationId')
  })
})

describe('editing an event that already exists', () => {
  const jakartaScrim = {
    title: 'Scrim vs RRQ',
    eventType: 'scrim' as const,
    allDay: false,
    // 20:00–22:00 in Jakarta.
    startsAt: '2026-03-05T13:00:00.000Z',
    endsAt: '2026-03-05T15:00:00.000Z',
    timezone: JAKARTA,
    location: 'Practice room',
    description: 'Two blocks.',
  }

  it('opens in the zone it was written in, not the reader’s', () => {
    const form = defaultsFromEvent(jakartaScrim)

    // Editing this from Berlin still says 20:00 Asia/Jakarta — the hour its
    // author meant — rather than 14:00 Europe/Berlin.
    expect(form.timezone).toBe(JAKARTA)
    expect(form.startDate).toBe('2026-03-05')
    expect(form.startTime).toBe('20:00')
    expect(form.endTime).toBe('22:00')
  })

  it('round-trips without moving the event', () => {
    const form = defaultsFromEvent(jakartaScrim)
    const input = toEventInput(form, 'org-1')

    expect(input.startsAt).toBe(jakartaScrim.startsAt)
    expect(input.endsAt).toBe(jakartaScrim.endsAt)
    expect(input.timezone).toBe(JAKARTA)
    expect(input.allDay).toBe(false)
  })

  it('round-trips an all-day event, exclusive end included', () => {
    const bootcamp = {
      ...jakartaScrim,
      allDay: true,
      title: 'Bootcamp',
      // Three whole days in Jakarta, ending at the midnight after the last.
      startsAt: '2026-03-04T17:00:00.000Z',
      endsAt: '2026-03-07T17:00:00.000Z',
    }
    const form = defaultsFromEvent(bootcamp)

    // The last day shown is the 6th, because the stored end is the midnight
    // that opens the 7th.
    expect(form.startDate).toBe('2026-03-05')
    expect(form.endDate).toBe('2026-03-07')

    const input = toEventInput(form, 'org-1')
    expect(input.startsAt).toBe(bootcamp.startsAt)
    expect(input.endsAt).toBe(bootcamp.endsAt)
    expect(input.allDay).toBe(true)
  })

  it('keeps a one-day all-day event one day long', () => {
    const day = {
      ...jakartaScrim,
      allDay: true,
      startsAt: '2026-03-04T17:00:00.000Z',
      endsAt: '2026-03-05T17:00:00.000Z',
    }
    const form = defaultsFromEvent(day)
    expect(form.startDate).toBe('2026-03-05')
    expect(form.endDate).toBe('2026-03-05')

    const input = toEventInput(form, 'org-1')
    expect(Date.parse(input.endsAt) - Date.parse(input.startsAt)).toBe(24 * 60 * 60 * 1000)
  })

  it('turns an absent location or description into empty fields, and back', () => {
    const form = defaultsFromEvent({ ...jakartaScrim, location: null, description: null })
    expect(form.location).toBe('')
    expect(form.description).toBe('')

    const input = toEventInput(form, 'org-1')
    expect(input.location).toBeNull()
    expect(input.description).toBeNull()
  })

  it('validates an edit exactly as it validates a new event', () => {
    const form = defaultsFromEvent(jakartaScrim)

    expect(eventFormSchema.safeParse({ ...form, title: '   ' }).success).toBe(false)
    expect(eventFormSchema.safeParse({ ...form, title: 'a'.repeat(121) }).success).toBe(false)
    expect(eventFormSchema.safeParse({ ...form, endTime: '19:00' }).success).toBe(false)
    expect(eventFormSchema.safeParse({ ...form, eventType: 'admin' as 'match' }).success).toBe(
      false,
    )
    expect(eventFormSchema.safeParse({ ...form, timezone: 'Mars/Olympus_Mons' }).success).toBe(
      false,
    )
    expect(eventFormSchema.safeParse({ ...form, title: 'Scrim vs ONIC' }).success).toBe(true)
  })

  it('carries the organization from the event rather than the form', () => {
    const input = toEventInput(defaultsFromEvent(jakartaScrim), 'org-7')
    expect(input.organizationId).toBe('org-7')
    expect(Object.keys(defaultsFromEvent(jakartaScrim))).not.toContain('organizationId')
  })
})

describe('the reminder on an event', () => {
  it('offers exactly the set the database accepts', () => {
    // `assert_valid_reminder` refuses anything else, so a value that reaches
    // the form and not the database would be a form that lies.
    expect(REMINDER_VALUES).toEqual(['none', '0', '5', '15', '30', '60', '1440'])
  })

  it('accepts every one of them, and nothing else', () => {
    for (const reminder of REMINDER_VALUES) {
      expect(eventFormSchema.safeParse(values({ title: 'Scrim', reminder })).success).toBe(true)
    }
    for (const nonsense of ['7', '-5', '1441', 'soon', '', '15 minutes']) {
      // Cast because the type already refuses these; what is under test is
      // that the schema refuses them too, for anything that skipped the type.
      const forged = { ...values({ title: 'Scrim' }), reminder: nonsense }
      expect(eventFormSchema.safeParse(forged).success, nonsense).toBe(false)
    }
  })

  it('defaults to none, so nothing is scheduled with one by accident', () => {
    expect(defaultsFor('2026-03-05', JAKARTA).reminder).toBe('none')
    expect(toEventInput(defaultsFor('2026-03-05', JAKARTA), 'org-1').reminderMinutes).toBeNull()
  })

  it('turns the form value into the minutes the service takes', () => {
    expect(reminderMinutesOf('none')).toBeNull()
    expect(reminderMinutesOf('0')).toBe(0)
    expect(reminderMinutesOf('15')).toBe(15)
    expect(reminderMinutesOf('1440')).toBe(1440)
  })

  it('and back again, including from an event that has none', () => {
    expect(reminderValueOf(null)).toBe('none')
    expect(reminderValueOf(undefined)).toBe('none')
    expect(reminderValueOf(0)).toBe('0')
    expect(reminderValueOf(30)).toBe('30')
    // A value the database should never hold reads as no reminder rather than
    // as a broken select with nothing in it.
    expect(reminderValueOf(7)).toBe('none')
  })

  it('travels with the event through the form and back', () => {
    const created = toEventInput(values({ reminder: '15' }), 'org-1')
    expect(created.reminderMinutes).toBe(15)

    const reopened = defaultsFromEvent({
      title: 'Scrim',
      eventType: 'scrim',
      allDay: false,
      startsAt: '2026-03-05T13:00:00.000Z',
      endsAt: '2026-03-05T15:00:00.000Z',
      timezone: JAKARTA,
      location: null,
      description: null,
      reminderMinutes: 15,
    })
    expect(reopened.reminder).toBe('15')
  })

  it('reads an event with no reminder as none, and can be given one', () => {
    const reopened = defaultsFromEvent({
      title: 'Scrim',
      eventType: 'scrim',
      allDay: false,
      startsAt: '2026-03-05T13:00:00.000Z',
      endsAt: '2026-03-05T15:00:00.000Z',
      timezone: JAKARTA,
      location: null,
      description: null,
      reminderMinutes: null,
    })
    expect(reopened.reminder).toBe('none')
    expect(toEventInput({ ...reopened, reminder: '60' }, 'org-1').reminderMinutes).toBe(60)
  })

  it('is attached to the instant the event actually starts, whoever is reading', () => {
    // The reminder is minutes before `starts_at`, and `starts_at` is an
    // instant the form builds in the event's own zone. So an all-day event
    // reminds relative to ITS midnight, not the reader's — and the
    // subtraction itself lives in Postgres, where there is one copy of it.
    const allDay = toEventInput(
      values({ allDay: true, startDate: '2026-03-05', endDate: '2026-03-05', reminder: '1440' }),
      'org-1',
    )
    expect(allDay.startsAt).toBe('2026-03-04T17:00:00.000Z')
    expect(allDay.reminderMinutes).toBe(1440)
  })
})
