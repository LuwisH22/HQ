import { expect, test, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The calendar keeping itself current.
 *
 * Every assertion here waits for a real Supabase Realtime event to travel from
 * one place to another: either from a second browser window driving the actual
 * form, or from a second signed-in client calling the same routine the form
 * calls. Nothing in this file invokes the invalidation by hand — a test that
 * did would pass with the subscription deleted.
 *
 * The two windows are the same account, because it is the only credential this
 * environment has. What delivery depends on is two sockets, not two people.
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
  'Set E2E_EMAIL / E2E_PASSWORD and the Supabase env to run the calendar realtime specs.',
)

const STORAGE = '.auth/owner.json'
test.use({ storageState: STORAGE })

/** One worker: these tests write rows a second window is watching for. */
test.describe.configure({ mode: 'serial' })

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
 * Titles and days carry the project, as the rest of the calendar suite does.
 * Desktop and mobile run this file at the same time against one database, and
 * a shared row would have each watching the other's changes.
 */
let SCOPE = 'E2E calendar realtime'
let WATCH_DAY = day(3)

let backend: SupabaseClient
let organizationId: string

test.beforeAll(async () => {
  const project = test.info().project.name
  SCOPE = `E2E calendar ${project} live`
  WATCH_DAY = day(project === 'mobile' ? 4 : 3)

  backend = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error } = await backend.auth.signInWithPassword({
    email: EMAIL as string,
    password: PASSWORD as string,
  })
  if (error) throw new Error(`realtime fixtures could not sign in: ${error.message}`)

  const { data: orgs } = await backend.from('organizations').select('id')
  organizationId = (orgs ?? [])[0]?.id as string
  if (!organizationId) throw new Error('realtime fixtures found no organization')

  await sweep()
})

async function sweep(): Promise<void> {
  const { data } = await backend.from('calendar_events').select('id').like('title', `${SCOPE}%`)
  for (const row of data ?? []) {
    await backend.rpc('delete_calendar_event', { p_event_id: row.id })
  }
}

test.afterEach(async () => {
  if (backend) await sweep()
})

test.afterAll(async () => {
  if (!backend) return
  await sweep()
  // Local scope: the default would revoke the session the other project is
  // sharing at the time.
  await backend.auth.signOut({ scope: 'local' })
})

/** Walk a page to the month these tests work in. */
async function goToMonth(page: Page): Promise<void> {
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

/** A second window, signed in as the same account and therefore a second socket. */
async function secondWindow(browser: Browser, like: Page): Promise<Page> {
  const context = await browser.newContext({
    storageState: STORAGE,
    viewport: like.viewportSize() ?? undefined,
    colorScheme: 'dark',
  })
  return context.newPage()
}

/** A row made by the other client, the way the form makes one. */
async function schedule(
  what: string,
  on: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; title: string }> {
  const title = `${SCOPE} ${what}`
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

const eventNamed = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(title) })

test.describe('two windows on the same calendar', () => {
  test('follows a create, an edit and a delete without anybody refreshing', async ({
    page,
    browser,
  }) => {
    const watcher = page
    const actor = await secondWindow(browser, page)
    const title = `${SCOPE} together`

    try {
      await goToMonth(watcher)
      await goToMonth(actor)

      // --- created ------------------------------------------------------
      await actor.getByRole('button', { name: `Open ${WATCH_DAY}` }).click()
      await actor.getByRole('button', { name: 'New event' }).click()
      const form = actor.getByRole('dialog')
      await form.getByLabel('Title').fill(title)
      await form.getByLabel('Start time').fill('20:00')
      await form.getByLabel('End time').fill('22:00')
      await form.getByRole('button', { name: 'Create event' }).click()
      await expect(actor.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

      // The watcher was never touched: no navigation, no reload, no click.
      await expect(eventNamed(watcher, title).first()).toBeVisible({ timeout: 20_000 })

      // --- edited -------------------------------------------------------
      const renamed = `${title} again`
      await eventNamed(actor, title).first().click()
      await actor.getByRole('dialog').getByRole('button', { name: 'Edit' }).click()
      await actor.getByRole('dialog').getByLabel('Title').fill(renamed)
      await actor.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click()
      await expect(actor.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

      await expect(eventNamed(watcher, renamed).first()).toBeVisible({ timeout: 20_000 })
      await expect(eventNamed(watcher, `${title}$`)).toHaveCount(0)

      // --- deleted ------------------------------------------------------
      await eventNamed(actor, renamed).first().click()
      await actor.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
      await actor.getByRole('dialog').getByRole('button', { name: 'Delete event' }).click()
      await expect(actor.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

      await expect(eventNamed(watcher, renamed)).toHaveCount(0, { timeout: 20_000 })
    } finally {
      await actor.context().close()
    }
  })
})

test.describe('changes made elsewhere', () => {
  test('an event scheduled by somebody else arrives on the right day', async ({ page }) => {
    await goToMonth(page)
    const event = await schedule('arrives', WATCH_DAY)

    const shown = eventNamed(page, event.title).first()
    await expect(shown).toBeVisible({ timeout: 20_000 })
    // A clock time rather than a particular one: the hour on screen is the
    // reader's zone, which is not the zone the event was written in.
    await expect(shown).toHaveAccessibleName(/\d{2}:\d{2}/)
  })

  test('an event moved out of the window leaves, and moved back returns', async ({ page }) => {
    const event = await schedule('travels', WATCH_DAY)
    await goToMonth(page)
    await expect(eventNamed(page, event.title).first()).toBeVisible({ timeout: 20_000 })

    // Three months away: outside every range this page has on screen.
    const far = new Date(Date.UTC(YEAR, Number(MONTH) + 2, 15, 13, 0, 0))
    await backend.rpc('update_calendar_event', {
      p_event_id: event.id,
      p_starts_at: far.toISOString(),
      p_ends_at: new Date(far.getTime() + 3_600_000).toISOString(),
    })
    await expect(eventNamed(page, event.title)).toHaveCount(0, { timeout: 20_000 })

    await backend.rpc('update_calendar_event', {
      p_event_id: event.id,
      p_starts_at: `${WATCH_DAY}T13:00:00.000Z`,
      p_ends_at: `${WATCH_DAY}T15:00:00.000Z`,
    })
    await expect(eventNamed(page, event.title).first()).toBeVisible({ timeout: 20_000 })
  })

  test('a timed event becoming an all-day one says so', async ({ page }) => {
    const event = await schedule('allday', WATCH_DAY)
    await goToMonth(page)
    await expect(eventNamed(page, event.title).first()).toHaveAccessibleName(/\d{2}:\d{2}/, {
      timeout: 20_000,
    })

    await backend.rpc('update_calendar_event', {
      p_event_id: event.id,
      p_all_day: true,
      p_starts_at: `${WATCH_DAY}T00:00:00.000Z`,
      p_ends_at: `${WATCH_DAY}T23:59:59.000Z`,
      p_timezone: 'Asia/Jakarta',
    })

    await expect(eventNamed(page, event.title).first()).toHaveAccessibleName(/All day/, {
      timeout: 20_000,
    })
  })

  test('the week and the day are right too, after a change arrives', async ({ page }) => {
    await goToMonth(page)
    const event = await schedule('views', WATCH_DAY)
    await expect(eventNamed(page, event.title).first()).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: `Open ${WATCH_DAY}` }).click()
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(eventNamed(page, event.title).first()).toBeVisible()

    const renamed = `${event.title} rewritten`
    await backend.rpc('update_calendar_event', { p_event_id: event.id, p_title: renamed })
    await expect(eventNamed(page, renamed).first()).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(eventNamed(page, renamed).first()).toBeVisible()

    await backend.rpc('delete_calendar_event', { p_event_id: event.id })
    await expect(eventNamed(page, renamed)).toHaveCount(0, { timeout: 20_000 })
  })

  test('an open detail dialog does not break when its event is removed', async ({ page }) => {
    const event = await schedule('vanishes', WATCH_DAY)
    await goToMonth(page)
    await eventNamed(page, event.title).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: event.title })).toBeVisible()

    await backend.rpc('delete_calendar_event', { p_event_id: event.id })

    // The dialog is allowed to go on showing what it opened with; what must
    // not happen is a crash, and what must happen is the calendar catching up.
    await page.waitForTimeout(4000)
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(eventNamed(page, event.title)).toHaveCount(0, { timeout: 20_000 })
  })
})

test.describe('the subscription itself', () => {
  /** Every realtime join and leave this page sent, by topic. */
  function watchFrames(page: Page): { joins: number; leaves: number } {
    const counted = { joins: 0, leaves: 0 }
    page.on('websocket', (socket) => {
      socket.on('framesent', (frame) => {
        const text = typeof frame.payload === 'string' ? frame.payload : ''
        if (!text.includes(`calendar:${organizationId}`)) return
        if (text.includes('phx_join')) counted.joins += 1
        if (text.includes('phx_leave')) counted.leaves += 1
      })
    })
    return counted
  }

  test('leaves exactly one subscription behind, however often you come and go', async ({
    page,
  }) => {
    const frames = watchFrames(page)
    // Joins minus leaves, which is the number that matters. A development
    // build mounts every effect twice, so counting joins alone would be
    // counting React rather than the subscription.
    const live = () => frames.joins - frames.leaves

    await goToMonth(page)
    await expect.poll(live, { timeout: 20_000 }).toBe(1)

    await page.getByRole('link', { name: 'Dashboard' }).first().click()
    await expect(page.getByRole('heading', { name: /Good |Still up/ })).toBeVisible({
      timeout: 20_000,
    })
    await expect.poll(live, { timeout: 20_000 }).toBe(0)

    await page.goto('/#/calendar')
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible({
      timeout: 20_000,
    })
    await expect.poll(live, { timeout: 20_000 }).toBe(1)

    // And a change still arrives exactly once after all that coming and going.
    const event = await schedule('again', WATCH_DAY)
    await expect(eventNamed(page, event.title)).toHaveCount(1, { timeout: 20_000 })
  })

  test('one change costs one refetch, not one per cached range', async ({ page }) => {
    // The other Playwright project writes to this same organization at the
    // same time, and its events legitimately reach this page too. So the
    // measure is reads per change that actually arrived, counted off the wire,
    // rather than an absolute number this test cannot control. The listener
    // goes on before the socket exists, because it only sees sockets opened
    // after it.
    const seen = { counting: false, changes: 0 }
    page.on('websocket', (socket) => {
      socket.on('framereceived', (frame) => {
        const text = typeof frame.payload === 'string' ? frame.payload : ''
        if (!seen.counting) return
        if (!text.includes('calendar_events')) return
        if (!/"type":"(INSERT|UPDATE|DELETE)"/.test(text)) return
        seen.changes += 1
      })
    })

    // Three months in the cache, one of them on screen. A change that
    // refetched every cached range rather than the mounted one would show up
    // here as several reads for a single event.
    await goToMonth(page)
    await page.getByRole('button', { name: 'Next month' }).click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Next month' }).click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Previous month' }).click()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await page.waitForTimeout(1500)

    let reads = 0
    await page.route('**/rest/v1/calendar_events*', (route) => {
      reads += 1
      return route.continue()
    })
    seen.counting = true

    const event = await schedule('once', WATCH_DAY)
    await expect(eventNamed(page, event.title).first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(2500)

    expect(seen.changes, 'no calendar change arrived over the socket').toBeGreaterThan(0)
    expect(
      reads,
      `${String(reads)} reads for ${String(seen.changes)} change(s)`,
    ).toBeLessThanOrEqual(seen.changes + 1)
  })

  test('the calendar still works when realtime cannot connect', async ({ page }) => {
    // Every websocket refused: the subscription can never open.
    await page.routeWebSocket(/realtime/, (socket) => {
      void socket.close()
    })

    await goToMonth(page)
    const event = await schedule('offline', WATCH_DAY)

    // No live update, and nothing alarming on the screen about it either.
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(eventNamed(page, event.title)).toHaveCount(0)

    // The queries remain the source of truth, so the event is there the moment
    // the calendar is asked again. This is the cost of realtime being down: a
    // refresh, rather than a broken page.
    await page.reload()
    await goToMonth(page)
    await expect(eventNamed(page, event.title).first()).toBeVisible({ timeout: 20_000 })

    // And creating one still works, because mutations never depended on it.
    await page.getByRole('button', { name: 'New event' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Title').fill(`${SCOPE} offline made`)
    await form.getByRole('button', { name: 'Create event' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    await expect(eventNamed(page, `${SCOPE} offline made`).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})

test.describe('narrow screens', () => {
  for (const width of [390, 412]) {
    test(`stays within ${String(width)}px while events arrive`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await goToMonth(page)

      const event = await schedule('narrow', WATCH_DAY)
      await expect(eventNamed(page, event.title).first()).toBeVisible({ timeout: 20_000 })

      const overflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflowing, `${String(width)}px`).toBe(false)
      // And exactly one copy of it, not one per event that arrived.
      await expect(eventNamed(page, event.title)).toHaveCount(1)
    })
  }
})
