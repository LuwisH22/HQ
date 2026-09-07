import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The calendar, against real events.
 *
 * There is no create form in this phase, so the events these specs assert on
 * are made through the same guarded routine the next phase's form will call,
 * from a second client signed in as the same account. That keeps the fixtures
 * honest — they are rows, subject to the same RLS the page reads through — and
 * every one of them is deleted again at the end.
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
const TIMED_DAY = `${String(YEAR)}-${MONTH}-12`
const ALL_DAY_DAY = `${String(YEAR)}-${MONTH}-18`

/** 20:00–22:00 in Jakarta on the 12th, which is 13:00–15:00 UTC. */
const TIMED_START = `${TIMED_DAY}T13:00:00.000Z`
const TIMED_END = `${TIMED_DAY}T15:00:00.000Z`
/** Midnight to midnight in Jakarta on the 18th. */
const ALL_DAY_START = `${String(YEAR)}-${MONTH}-17T17:00:00.000Z`
const ALL_DAY_END = `${ALL_DAY_DAY}T17:00:00.000Z`

const TIMED_TITLE = 'E2E calendar scrim'
const ALL_DAY_TITLE = 'E2E calendar bootcamp'

let backend: SupabaseClient
const created: string[] = []

test.beforeAll(async () => {
  backend = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error: authError } = await backend.auth.signInWithPassword({
    email: EMAIL as string,
    password: PASSWORD as string,
  })
  if (authError) throw new Error(`calendar fixtures could not sign in: ${authError.message}`)

  const { data: orgs } = await backend.from('organizations').select('id')
  const organizationId = (orgs ?? [])[0]?.id as string | undefined
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
 * Every event this suite has ever made, by name.
 *
 * By title rather than only by the ids of this run: a run that dies between
 * creating and deleting must not poison the next one, and these titles belong
 * to nothing else.
 */
async function sweep(): Promise<void> {
  const { data } = await backend.from('calendar_events').select('id').like('title', 'E2E calendar%')
  for (const row of data ?? []) {
    await backend.rpc('delete_calendar_event', { p_event_id: row.id })
  }
}

test.afterAll(async () => {
  await sweep()
  created.length = 0
  await backend.auth.signOut()
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
  test('opens read-only, with no way to edit or delete', async ({ page }) => {
    await goToFixtureMonth(page)
    await timedEvent(page).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: TIMED_TITLE })).toBeVisible()
    await expect(dialog.getByText('Practice room')).toBeVisible()
    await expect(dialog.getByText('Two blocks, VOD review after.')).toBeVisible()

    // Phase 5.2 shows; it does not change.
    await expect(dialog.getByRole('button', { name: /edit|delete|remove/i })).toHaveCount(0)

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

test.describe('narrow screens', () => {
  for (const width of [390, 412]) {
    test(`fits ${String(width)}px without a page-level overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await goToFixtureMonth(page)

      for (const view of ['Month', 'Week', 'Day']) {
        await page.getByRole('button', { name: view, exact: true }).click()
        await page.waitForTimeout(400)
        const overflowing = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        )
        expect(overflowing, `${view} at ${String(width)}px`).toBe(false)
      }
    })
  }
})
