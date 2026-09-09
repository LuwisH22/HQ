import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The calendar, against real events.
 *
 * The events these specs read are made through the same guarded routine the
 * create form calls, from a second client signed in as the same account. That
 * keeps the fixtures honest — they are rows, subject to the same RLS the page
 * reads through — and every one of them, along with anything the form creates,
 * is swept by title at the end.
 *
 * The window they are scheduled in is deliberately far from today, so a run
 * can navigate to them deterministically and nothing lands on a real week.
 */

/**
 * The Supabase URL and key live in `.env`, which the Playwright config does
 * not load into the environment — it only reads `.env.e2e` for credentials.
 * Read the same way the verification scripts do rather than requiring the
 * runner to export them.
 */
function fromEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...fromEnvFile('.env'), ...fromEnvFile('.env.e2e'), ...process.env }
const EMAIL = env.E2E_EMAIL
const PASSWORD = env.E2E_PASSWORD
const URL = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY

test.skip(
  !EMAIL || !PASSWORD || !URL || !KEY,
  'Set E2E_EMAIL / E2E_PASSWORD and the Supabase env to run the calendar specs.',
)

test.use({ storageState: '.auth/owner.json' })

/**
 * One worker for the whole file.
 *
 * The fixtures are rows in a shared database, and `beforeAll` runs once per
 * worker: split across two, this suite would schedule everything twice and
 * then fail on its own duplicates.
 */
test.describe.configure({ mode: 'serial' })

/**
 * Next month, which is one click away and is not today.
 *
 * Far enough that a fixture cannot be mistaken for something real on this
 * week's calendar, near enough that reaching it is a single navigation rather
 * than fifty.
 */
const NEXT_MONTH = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1))
const YEAR = NEXT_MONTH.getUTCFullYear()
const MONTH = String(NEXT_MONTH.getUTCMonth() + 1).padStart(2, '0')
const MONTH_TITLE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
}).format(NEXT_MONTH)

const day = (of: number) => `${String(YEAR)}-${MONTH}-${String(of).padStart(2, '0')}`

/**
 * Every day this file touches, one project's worth.
 *
 * Desktop and mobile run at the same time against one database, so they are
 * given separate days as well as separate titles: two events in one cell
 * overlap, and a click meant for one lands on the other. The values below are
 * placeholders; `beforeAll` fills them in, knowing which project it is.
 */
let TIMED_DAY = day(12)
let ALL_DAY_DAY = day(18)

/** 20:00–22:00 in Jakarta on the 12th, which is 13:00–15:00 UTC. */
let TIMED_START = `${TIMED_DAY}T13:00:00.000Z`
let TIMED_END = `${TIMED_DAY}T15:00:00.000Z`
/** Midnight to midnight in Jakarta on the 18th. */
let ALL_DAY_START = `${day(17)}T17:00:00.000Z`
let ALL_DAY_END = `${ALL_DAY_DAY}T17:00:00.000Z`

/** Days the create suite writes to, kept apart from the read fixtures. */
let CREATE_DAY = day(21)
let CREATE_ALL_DAY = day(23)
let CREATE_TWICE_DAY = day(25)

/**
 * Titles carry the project that made them.
 *
 * Desktop and mobile run this file at the same time against one database. A
 * shared title would have each project sweeping the other's fixtures away
 * mid-run, and two buttons answering to the same name; a scoped one means each
 * only ever sees, edits and deletes rows it made itself. The values are filled
 * in once, in `beforeAll`, before any test body runs.
 */
let SCOPE = 'E2E calendar'
let TIMED_TITLE = `${SCOPE} scrim`
let ALL_DAY_TITLE = `${SCOPE} bootcamp`
let CREATED_TIMED = `${SCOPE} made here`
let CREATED_ALL_DAY = `${SCOPE} made all day`
let CREATED_TWICE = `${SCOPE} made once`

/**
 * The two days the edit and delete specs work on.
 *
 * Unlike the read fixtures, these tests move and remove rows, so each project
 * gets a day of its own and clears up after every test — a cell holds three
 * events before it starts hiding them behind a count.
 */
let WORK_DAY = day(5)
let MOVED_DAY = day(8)

let backend: SupabaseClient
let organizationId: string
const created: string[] = []

test.beforeAll(async () => {
  const testInfo = test.info()
  SCOPE = `E2E calendar ${testInfo.project.name}`
  TIMED_TITLE = `${SCOPE} scrim`
  ALL_DAY_TITLE = `${SCOPE} bootcamp`
  CREATED_TIMED = `${SCOPE} made here`
  CREATED_ALL_DAY = `${SCOPE} made all day`
  CREATED_TWICE = `${SCOPE} made once`
  // One day apart, so neither project ever writes into the other's cell.
  const shift = testInfo.project.name === 'mobile' ? 1 : 0
  WORK_DAY = day(5 + shift)
  MOVED_DAY = day(8 + shift)
  TIMED_DAY = day(12 + shift)
  ALL_DAY_DAY = day(18 + shift)
  CREATE_DAY = day(21 + shift)
  CREATE_ALL_DAY = day(23 + shift)
  CREATE_TWICE_DAY = day(25 + shift)
  TIMED_START = `${TIMED_DAY}T13:00:00.000Z`
  TIMED_END = `${TIMED_DAY}T15:00:00.000Z`
  ALL_DAY_START = `${day(17 + shift)}T17:00:00.000Z`
  ALL_DAY_END = `${ALL_DAY_DAY}T17:00:00.000Z`

  backend = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error: authError } = await backend.auth.signInWithPassword({
    email: EMAIL as string,
    password: PASSWORD as string,
  })
  if (authError) throw new Error(`calendar fixtures could not sign in: ${authError.message}`)

  const { data: orgs } = await backend.from('organizations').select('id')
  organizationId = (orgs ?? [])[0]?.id as string
  if (!organizationId) throw new Error('calendar fixtures found no organization')

  // Anything a crashed run left behind, before adding more of it.
  await sweep()

  for (const event of [
    {
      p_organization_id: organizationId,
      p_title: TIMED_TITLE,
      p_starts_at: TIMED_START,
      p_ends_at: TIMED_END,
      p_all_day: false,
      p_timezone: 'Asia/Jakarta',
      p_event_type: 'scrim',
      p_location: 'Practice room',
      p_description: 'Two blocks, VOD review after.',
    },
    {
      p_organization_id: organizationId,
      p_title: ALL_DAY_TITLE,
      p_starts_at: ALL_DAY_START,
      p_ends_at: ALL_DAY_END,
      p_all_day: true,
      p_timezone: 'Asia/Jakarta',
      p_event_type: 'event',
    },
  ]) {
    const { data, error } = await backend.rpc('create_calendar_event', event)
    if (error) throw new Error(`calendar fixture failed: ${error.message}`)
    created.push(data as string)
  }
})

/**
 * Every event this project has ever made, by name.
 *
 * By title rather than only by the ids of this run: a run that dies between
 * creating and deleting must not poison the next one, and these titles belong
 * to nothing else.
 */
async function sweep(): Promise<void> {
  const { data } = await backend.from('calendar_events').select('id').like('title', `${SCOPE}%`)
  for (const row of data ?? []) {
    await backend.rpc('delete_calendar_event', { p_event_id: row.id })
  }
}

/** The rows one test made for itself, which the next test must not see. */
async function sweepWork(): Promise<void> {
  const { data } = await backend
    .from('calendar_events')
    .select('id')
    .like('title', `${SCOPE} work%`)
  for (const row of data ?? []) {
    await backend.rpc('delete_calendar_event', { p_event_id: row.id })
  }
}

test.afterAll(async () => {
  await sweep()
  created.length = 0
  // Local scope only. The default revokes every refresh token this account
  // holds, which would sign the other project out of the session both share
  // while it is still running.
  await backend.auth.signOut({ scope: 'local' })
})

/** Walk the month view to the fixtures' month, however far away it is. */
async function goToFixtureMonth(page: Page): Promise<void> {
  await page.goto('/#/calendar')
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible({
    timeout: 20_000,
  })

  const title = page.getByRole('heading', { level: 2 })
  const next = page.getByRole('button', { name: 'Next month' })
  for (let i = 0; i < 4; i += 1) {
    if ((await title.textContent())?.includes(MONTH_TITLE)) return
    await next.click()
  }
  throw new Error(`could not reach ${MONTH_TITLE}`)
}

const timedEvent = (page: Page) => page.getByRole('button', { name: new RegExp(TIMED_TITLE) })
const allDayEvent = (page: Page) => page.getByRole('button', { name: new RegExp(ALL_DAY_TITLE) })

test.describe('month view', () => {
  test('opens on the current month with a today marker', async ({ page }) => {
    await page.goto('/#/calendar')
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible({
      timeout: 20_000,
    })

    const now = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
      new Date(),
    )
    // The month may be named in the viewer's zone rather than the runner's, so
    // this asserts the shape rather than an exact string.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(/\w+ \d{4}/)
    expect(now).toMatch(/\w+ \d{4}/)

    // Today is marked in a word, not only in a tone.
    await expect(page.getByText('Today', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeDisabled()
  })

  test('steps forward and back, and Today comes home', async ({ page }) => {
    await page.goto('/#/calendar')
    const title = page.getByRole('heading', { level: 2 })
    await expect(title).toBeVisible({ timeout: 20_000 })
    const start = await title.textContent()

    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(title).not.toHaveText(start ?? '')

    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(title).toHaveText(start ?? '')

    await page.getByRole('button', { name: 'Next month' }).click()
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(title).toHaveText(start ?? '')
  })

  test('puts events on the day they belong to', async ({ page }) => {
    await goToFixtureMonth(page)

    await expect(timedEvent(page)).toBeVisible()
    await expect(allDayEvent(page)).toBeVisible()

    // The all-day event says so instead of pretending to start at 00:00.
    await expect(allDayEvent(page)).toHaveAccessibleName(/All day/)
    await expect(timedEvent(page)).toHaveAccessibleName(/\d{2}:\d{2}/)
  })
})

test.describe('event detail', () => {
  test('opens on the event, and offers what the reader may do to it', async ({ page }) => {
    await goToFixtureMonth(page)
    await timedEvent(page).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: TIMED_TITLE })).toBeVisible()
    await expect(dialog.getByText('Practice room')).toBeVisible()
    await expect(dialog.getByText('Two blocks, VOD review after.')).toBeVisible()

    // This account holds calendar.manage, so both ways of changing it are here.
    await expect(dialog.getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Delete' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('says the hour it was meant in when that is somewhere else', async ({ page }) => {
    await goToFixtureMonth(page)
    await timedEvent(page).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Either the reader is in Jakarta — in which case there is nothing to add
    // — or the event's own zone is named beside the time.
    const zoneNote = dialog.getByText(/in Asia\/Jakarta/)
    const readerIsThere = (await page.getByText('Times shown in Asia/Jakarta').count()) > 0
    await expect(zoneNote).toHaveCount(readerIsThere ? 0 : 1)
  })
})

test.describe('week and day', () => {
  test('switches views and keeps the day it was showing', async ({ page }) => {
    await goToFixtureMonth(page)
    const title = page.getByRole('heading', { level: 2 })

    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(title).toHaveText(new RegExp(String(YEAR)))

    await page.getByRole('button', { name: 'Day', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(title).toHaveText(new RegExp(`\\w+, \\d+ \\w+ ${String(YEAR)}`))

    await page.getByRole('button', { name: 'Month', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Month', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(title).toHaveText(MONTH_TITLE)
  })

  test('opens a day from the month grid and finds its events', async ({ page }) => {
    await goToFixtureMonth(page)
    await page.getByRole('button', { name: `Open ${TIMED_DAY}` }).click()

    await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(timedEvent(page)).toBeVisible()
    // The other fixture is on a different day, so it is not here.
    await expect(allDayEvent(page)).toHaveCount(0)
  })

  test('steps a day at a time in the day view', async ({ page }) => {
    await goToFixtureMonth(page)
    await page.getByRole('button', { name: `Open ${TIMED_DAY}` }).click()
    const title = page.getByRole('heading', { level: 2 })
    const start = await title.textContent()

    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(title).not.toHaveText(start ?? '')
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(title).toHaveText(start ?? '')
  })

  test('shows an all-day event in the all-day row, not on the timeline', async ({ page }) => {
    await goToFixtureMonth(page)
    await page.getByRole('button', { name: `Open ${ALL_DAY_DAY}` }).click()
    await expect(allDayEvent(page)).toBeVisible()
    await expect(allDayEvent(page)).toHaveAccessibleName(/All day/)
  })
})

test.describe('the page itself', () => {
  test('asks only for the window on screen', async ({ page }) => {
    const ranges: string[] = []
    await page.route('**/rest/v1/calendar_events*', (route) => {
      ranges.push(route.request().url())
      return route.continue()
    })

    await page.goto('/#/calendar')
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible({
      timeout: 20_000,
    })
    await page.waitForTimeout(1500)

    expect(ranges.length).toBeGreaterThan(0)
    for (const url of ranges) {
      // Both ends of the window, and an organization: never an unbounded read.
      expect(url).toContain('starts_at=lt.')
      expect(url).toContain('ends_at=gt.')
      expect(url).toContain('organization_id=eq.')
    }
  })

  test('is reachable and operable from the keyboard', async ({ page }) => {
    await goToFixtureMonth(page)

    await page.getByRole('button', { name: 'Next month' }).focus()
    await expect(page.getByRole('button', { name: 'Next month' })).toBeFocused()

    // An event is a button, so it opens with the keyboard like any other.
    await timedEvent(page).focus()
    await expect(timedEvent(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')

    // And the view switcher reports its state rather than only looking chosen.
    await expect(page.getByRole('group', { name: 'Calendar view' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Month', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

test.describe('states', () => {
  test('says so when a month has nothing in it', async ({ page }) => {
    await page.goto('/#/calendar')
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible({
      timeout: 20_000,
    })

    // Past the fixtures, which are next month, and past anything real: three
    // steps rather than ten, because each one is a query.
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Next month' }).click()

    await expect(page.getByText('No events scheduled.')).toBeVisible({ timeout: 15_000 })
    // And the grid is still there: an empty month is a month, not a blank page.
    await expect(
      page.getByRole('button', { name: /^Open \d{4}-\d{2}-\d{2}/ }).first(),
    ).toBeVisible()
  })

  test('says what went wrong when the range cannot be read', async ({ page }) => {
    await page.route('**/rest/v1/calendar_events*', (route) =>
      route.fulfill({ status: 500, body: '{"message":"boom"}' }),
    )
    await page.goto('/#/calendar')
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible({
      timeout: 20_000,
    })

    // The shared error surface, which carries the retry when the failure is
    // one worth retrying.
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(alert).toContainText(/something went wrong|offline/i)
    // And the calendar is not pretending to be empty at the same time.
    await expect(page.getByText('No events scheduled.')).toHaveCount(0)
  })
})

test.describe('creating an event', () => {
  test('is offered to somebody who may, and opens a form', async ({ page }) => {
    await page.goto('/#/calendar')
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible({
      timeout: 20_000,
    })

    await page.getByRole('button', { name: 'New event' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Create event' })).toBeVisible()

    // The form opens on the day the calendar is looking at.
    await expect(dialog.getByLabel('Title')).toBeFocused()
    await expect(dialog.getByLabel('Starts')).toHaveValue(/\d{4}-\d{2}-\d{2}/)
  })

  test('will not submit an event with no title', async ({ page }) => {
    await page.goto('/#/calendar')
    await page.getByRole('button', { name: 'New event' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Create event' }).click()

    await expect(page.getByText('A title is required')).toBeVisible()
    await expect(dialog).toBeVisible()
  })

  test('will not submit an event that ends before it starts', async ({ page }) => {
    await page.goto('/#/calendar')
    await page.getByRole('button', { name: 'New event' }).click()
    const dialog = page.getByRole('dialog')

    await dialog.getByLabel('Title').fill(`${SCOPE} backwards`)
    await dialog.getByLabel('Start time').fill('20:00')
    await dialog.getByLabel('End time').fill('19:00')
    await dialog.getByRole('button', { name: 'Create event' }).click()

    await expect(page.getByText('An event has to end after it starts')).toBeVisible()
    await expect(dialog).toBeVisible()
  })

  test('closes without creating anything when cancelled', async ({ page }) => {
    await goToFixtureMonth(page)
    await page.getByRole('button', { name: 'New event' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`${SCOPE} cancelled`)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: new RegExp(`${SCOPE} cancelled`) })).toHaveCount(
      0,
    )
  })

  test('creates a timed event, which lands on its own day at its own hour', async ({ page }) => {
    await goToFixtureMonth(page)
    await page.getByRole('button', { name: `Open ${CREATE_DAY}` }).click()
    await page.getByRole('button', { name: 'New event' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`  ${CREATED_TIMED}  `)
    await dialog.getByLabel('Start time').fill('20:00')
    await dialog.getByLabel('End time').fill('22:00')
    await dialog.getByLabel('Location').fill('Practice room')
    await dialog.getByRole('button', { name: 'Create event' }).click()

    // The dialog closes, the calendar keeps its place, and the event is there.
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    const madeHere = page.getByRole('button', { name: new RegExp(CREATED_TIMED) })
    await expect(madeHere.first()).toBeVisible({ timeout: 15_000 })
    // Trimmed, not stored with the spaces it was typed with.
    await expect(madeHere.first()).toHaveAccessibleName(new RegExp(`^${CREATED_TIMED},`))
    await expect(madeHere.first()).toHaveAccessibleName(/20:00/)

    // And it is a real row: the detail says so.
    await madeHere.first().click()
    const detail = page.getByRole('dialog')
    await expect(detail.getByRole('heading', { name: CREATED_TIMED })).toBeVisible()
    await expect(detail.getByText('Practice room')).toBeVisible()
  })

  test('creates an all-day event, which appears as all day', async ({ page }) => {
    await goToFixtureMonth(page)
    await page.getByRole('button', { name: `Open ${CREATE_ALL_DAY}` }).click()
    await page.getByRole('button', { name: 'New event' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(CREATED_ALL_DAY)
    await dialog.getByLabel('All day').click()
    // The clock fields go away, because an all-day event has no clock.
    await expect(dialog.getByLabel('Start time')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Create event' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    const madeAllDay = page.getByRole('button', { name: new RegExp(CREATED_ALL_DAY) })
    await expect(madeAllDay.first()).toBeVisible({ timeout: 15_000 })
    await expect(madeAllDay.first()).toHaveAccessibleName(/All day/)
  })

  test('cannot be submitted twice', async ({ page }) => {
    await goToFixtureMonth(page)
    await page.getByRole('button', { name: `Open ${CREATE_TWICE_DAY}` }).click()
    await page.getByRole('button', { name: 'New event' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(CREATED_TWICE)
    const submit = dialog.getByRole('button', { name: 'Create event' })

    // Two presses in the time one request takes: the button locks itself.
    await submit.click()
    await submit.click({ force: true, timeout: 2_000 }).catch(() => undefined)
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    const { data } = await backend.from('calendar_events').select('id').eq('title', CREATED_TWICE)
    expect(data?.length).toBe(1)
  })

  test('is refused by the database however it is asked', async ({ page }) => {
    // The page never sends this, but a client could: an organization the
    // caller is not in, straight at the routine the form uses.
    const status = await page.evaluate(
      async ([url, key]) => {
        const response = await fetch(`${url}/rest/v1/rpc/create_calendar_event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: key },
          body: JSON.stringify({
            p_organization_id: '00000000-0000-4000-8000-000000000000',
            p_title: 'E2E calendar cross-org',
            p_starts_at: '2031-01-01T10:00:00.000Z',
            p_ends_at: '2031-01-01T11:00:00.000Z',
          }),
        })
        return response.status
      },
      [URL as string, KEY as string],
    )

    expect(status).toBeGreaterThanOrEqual(400)

    const { data } = await backend
      .from('calendar_events')
      .select('id')
      .eq('title', 'E2E calendar cross-org')
    expect(data?.length ?? 0).toBe(0)
  })
})

/**
 * A row of this project's own, made the way the form makes one.
 *
 * Every event the editing and deleting specs touch is created here rather than
 * shared, so a test that renames or removes one cannot change what the next
 * test reads. 13:00 UTC is the same calendar day from UTC-13 to UTC+11, so the
 * grid puts it on `on` wherever the run happens to be.
 */
async function schedule(
  what: string,
  on: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; title: string }> {
  const title = `${SCOPE} work ${what}`
  const { data, error } = await backend.rpc('create_calendar_event', {
    p_organization_id: organizationId,
    p_title: title,
    p_starts_at: `${on}T13:00:00.000Z`,
    p_ends_at: `${on}T15:00:00.000Z`,
    p_all_day: false,
    p_timezone: 'Asia/Jakarta',
    p_event_type: 'scrim',
    ...extra,
  })
  if (error) throw new Error(`could not schedule ${title}: ${error.message}`)
  return { id: data as string, title }
}

/** What the database currently holds for one event, or nothing at all. */
interface StoredEvent {
  title: string
  starts_at: string
  ends_at: string
  all_day: boolean
  timezone: string
  organization_id: string
}

async function rowOf(id: string): Promise<StoredEvent | undefined> {
  const { data } = await backend
    .from('calendar_events')
    .select('title, starts_at, ends_at, all_day, timezone, organization_id')
    .eq('id', id)
  return (data ?? [])[0]
}

/** Open an event from the month grid and land in its detail dialog. */
async function openEvent(page: Page, title: string) {
  await goToFixtureMonth(page)
  const button = page.getByRole('button', { name: new RegExp(title) }).first()
  await expect(button).toBeVisible({ timeout: 15_000 })
  await button.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

/** The instant an ISO string names, written the one way this file compares. */
const at = (iso: string | undefined) => new Date(iso ?? 0).toISOString()

/** The day before one, which is where a Jakarta midnight sits in UTC. */
const dayBefore = (key: string) =>
  new Date(new Date(`${key}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10)

test.describe('editing an event', () => {
  test.afterEach(async () => {
    if (backend) await sweepWork()
  })

  test('opens filled in, in the zone the event was written in', async ({ page }) => {
    const event = await schedule('open', WORK_DAY)
    const detail = await openEvent(page, event.title)
    await detail.getByRole('button', { name: 'Edit' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Edit event' })).toBeVisible()
    await expect(dialog.getByLabel('Title')).toHaveValue(event.title)
    await expect(dialog.getByLabel('Starts')).toHaveValue(WORK_DAY)
    // Written as 20:00 in Jakarta, and shown that way from anywhere.
    await expect(dialog.getByLabel('Start time')).toHaveValue('20:00')
    await expect(dialog.getByLabel('End time')).toHaveValue('22:00')

    // Nothing has been changed yet, so there is nothing to save.
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  test('renames an event, and the calendar shows the new name', async ({ page }) => {
    const event = await schedule('rename', WORK_DAY)
    const renamed = `${event.title} again`

    const detail = await openEvent(page, event.title)
    await detail.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(renamed)
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: new RegExp(renamed) })).toBeVisible({
      timeout: 15_000,
    })

    // The row itself, not only what the page redrew.
    const row = await rowOf(event.id)
    expect(row?.title).toBe(renamed)
    // And nothing else moved with it.
    expect(at(row?.starts_at)).toBe(`${WORK_DAY}T13:00:00.000Z`)
  })

  test('moves an event to another day and hour', async ({ page }) => {
    const event = await schedule('move', WORK_DAY)

    const detail = await openEvent(page, event.title)
    await detail.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Starts').fill(MOVED_DAY)
    await dialog.getByLabel('Ends').fill(MOVED_DAY)
    await dialog.getByLabel('Start time').fill('09:00')
    await dialog.getByLabel('End time').fill('10:30')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    // 09:00 in Jakarta is 02:00 UTC, which is the instant that was stored.
    const row = await rowOf(event.id)
    expect(at(row?.starts_at)).toBe(`${MOVED_DAY}T02:00:00.000Z`)
    expect(at(row?.ends_at)).toBe(`${MOVED_DAY}T03:30:00.000Z`)
    expect(row?.timezone).toBe('Asia/Jakarta')

    // And the day it used to be on no longer has it.
    await page.getByRole('button', { name: `Open ${WORK_DAY}` }).click()
    await expect(page.getByRole('button', { name: new RegExp(event.title) })).toHaveCount(0)
  })

  test('turns a timed event into an all-day one', async ({ page }) => {
    const event = await schedule('allday', WORK_DAY)

    const detail = await openEvent(page, event.title)
    await detail.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('All day').click()
    await expect(dialog.getByLabel('Start time')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    // Midnight to the following midnight in Jakarta, which is 17:00 UTC on the
    // day before either end.
    const row = await rowOf(event.id)
    expect(row?.all_day).toBe(true)
    expect(at(row?.starts_at)).toBe(`${dayBefore(WORK_DAY)}T17:00:00.000Z`)
    expect(at(row?.ends_at)).toBe(`${WORK_DAY}T17:00:00.000Z`)

    await expect(
      page.getByRole('button', { name: new RegExp(event.title) }).first(),
    ).toHaveAccessibleName(/All day/)
  })

  test('will not save an event that ends before it starts', async ({ page }) => {
    const event = await schedule('backwards', WORK_DAY)

    const detail = await openEvent(page, event.title)
    await detail.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('End time').fill('19:00')
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByText('An event has to end after it starts')).toBeVisible()
    await expect(dialog).toBeVisible()

    // And the row is exactly as it was.
    expect(at((await rowOf(event.id))?.ends_at)).toBe(`${WORK_DAY}T15:00:00.000Z`)
  })

  test('says why in words when the save is refused', async ({ page }) => {
    const event = await schedule('vanish', WORK_DAY)

    const detail = await openEvent(page, event.title)
    await detail.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`${event.title} edited`)

    // Somebody else removes it between opening the form and saving it.
    await backend.rpc('delete_calendar_event', { p_event_id: event.id })
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    const alert = dialog.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(alert).toContainText('Event not found')
    // A sentence, not a dump: no error codes, no JSON, no stack.
    expect((await alert.textContent()) ?? '').not.toMatch(/PGRST|P0002|[{}]|at .*\.ts/)

    // The form stays open with what was typed still in it.
    await expect(dialog.getByLabel('Title')).toHaveValue(`${event.title} edited`)

    // And the calendar behind it has caught up: closing the form reveals a
    // grid that is no longer offering an event which does not exist.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    // The dialog first: while one is open the page behind it is aria-hidden,
    // and a role query would answer 0 for that reason rather than this one.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: new RegExp(event.title) })).toHaveCount(0, {
      timeout: 15_000,
    })
  })
})

test.describe('deleting an event', () => {
  test.afterEach(async () => {
    if (backend) await sweepWork()
  })

  test('asks first, and names the event it is about to remove', async ({ page }) => {
    const event = await schedule('confirm', WORK_DAY)

    const detail = await openEvent(page, event.title)
    await detail.getByRole('button', { name: 'Delete' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Delete event?' })).toBeVisible()
    await expect(dialog.getByText('This cannot be undone.')).toBeVisible()
    await expect(dialog.getByText(event.title)).toBeVisible()

    // Nothing has happened yet.
    expect(await rowOf(event.id)).toBeTruthy()
  })

  test('leaves the event alone when the question is declined', async ({ page }) => {
    const event = await schedule('cancel', WORK_DAY)

    const detail = await openEvent(page, event.title)
    await detail.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await rowOf(event.id)).toBeTruthy()
    await expect(page.getByRole('button', { name: new RegExp(event.title) }).first()).toBeVisible()
  })

  test('removes it, and the calendar stops showing it', async ({ page }) => {
    const event = await schedule('gone', WORK_DAY)

    const detail = await openEvent(page, event.title)
    await detail.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete event' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: new RegExp(event.title) })).toHaveCount(0, {
      timeout: 15_000,
    })
    expect(await rowOf(event.id)).toBeUndefined()
  })

  test('says why in words when the deletion is refused', async ({ page }) => {
    const event = await schedule('twice', WORK_DAY)

    const detail = await openEvent(page, event.title)
    await detail.getByRole('button', { name: 'Delete' }).click()

    // Somebody else got there first.
    await backend.rpc('delete_calendar_event', { p_event_id: event.id })
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Delete event' }).click()

    const alert = dialog.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(alert).toContainText('Event not found')
    expect((await alert.textContent()) ?? '').not.toMatch(/PGRST|P0002|[{}]|at .*\.ts/)
    // The confirmation is still up rather than pretending to have worked.
    await expect(dialog.getByRole('heading', { name: 'Delete event?' })).toBeVisible()

    // And behind it the calendar has stopped showing the event.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    // The dialog first: while one is open the page behind it is aria-hidden,
    // and a role query would answer 0 for that reason rather than this one.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: new RegExp(event.title) })).toHaveCount(0, {
      timeout: 15_000,
    })
  })
})

test.describe('authorization the page cannot grant', () => {
  test.afterEach(async () => {
    if (backend) await sweepWork()
  })

  test('refuses a caller with no session, whichever routine is asked', async ({ page }) => {
    const event = await schedule('anon', WORK_DAY)

    // The anon key alone: a real request to the real endpoint, carrying no
    // user at all. Both routines have to refuse it.
    const statuses = await page.evaluate(
      async ([url, key, id]) => {
        const call = async (name: string, body: Record<string, unknown>) => {
          const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: key },
            body: JSON.stringify(body),
          })
          return response.status
        }
        return [
          await call('update_calendar_event', { p_event_id: id, p_title: 'taken over' }),
          await call('delete_calendar_event', { p_event_id: id }),
        ]
      },
      [URL as string, KEY as string, event.id],
    )

    for (const status of statuses) expect(status).toBeGreaterThanOrEqual(400)

    // Untouched, and still there.
    expect((await rowOf(event.id))?.title).toBe(event.title)
  })

  test('will not let an event change organizations', async () => {
    const event = await schedule('org', WORK_DAY)

    // There is no organization parameter to send, so the call itself is
    // rejected — and the row stays where it was.
    const { error } = await backend.rpc('update_calendar_event', {
      p_event_id: event.id,
      p_organization_id: '00000000-0000-4000-8000-000000000000',
    })
    expect(error).toBeTruthy()

    expect((await rowOf(event.id))?.organization_id).toBe(organizationId)
  })
})

test.describe('narrow screens', () => {
  const overflowing = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

  for (const width of [390, 412]) {
    test(`fits ${String(width)}px without a page-level overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await goToFixtureMonth(page)

      for (const view of ['Month', 'Week', 'Day']) {
        await page.getByRole('button', { name: view, exact: true }).click()
        await page.waitForTimeout(400)
        expect(await overflowing(page), `${view} at ${String(width)}px`).toBe(false)
      }
    })

    test(`shows the edit and delete dialogs at ${String(width)}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      const event = await schedule('narrow', WORK_DAY)

      const detail = await openEvent(page, event.title)
      expect(await overflowing(page), `detail at ${String(width)}px`).toBe(false)

      await detail.getByRole('button', { name: 'Edit' }).click()
      const form = page.getByRole('dialog')
      await expect(form.getByRole('heading', { name: 'Edit event' })).toBeVisible()
      await expect(form.getByRole('button', { name: 'Save changes' })).toBeVisible()
      expect(await overflowing(page), `edit at ${String(width)}px`).toBe(false)
      await form.getByRole('button', { name: 'Cancel' }).click()

      await page
        .getByRole('button', { name: new RegExp(event.title) })
        .first()
        .click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
      const confirm = page.getByRole('dialog')
      await expect(confirm.getByRole('heading', { name: 'Delete event?' })).toBeVisible()
      await expect(confirm.getByRole('button', { name: 'Delete event' })).toBeVisible()
      expect(await overflowing(page), `delete at ${String(width)}px`).toBe(false)

      await sweepWork()
    })
  }
})
