import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Reminders, from the form to the bell.
 *
 * The configuration half is ordinary: a field on the create and edit forms,
 * a row on the detail, and a column in the database that has to agree with all
 * three. The delivery half is invoked rather than waited for — a reminder due
 * in fifteen minutes is made due now by scheduling the event fifteen minutes
 * out, and the routine a scheduler would call is called here instead. Nothing
 * sleeps for a day, and nothing pretends a notification appeared when it did
 * not.
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
  'Set E2E_EMAIL / E2E_PASSWORD and the Supabase env to run the reminder specs.',
)

test.use({ storageState: '.auth/owner.json' })
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

/** Its own titles and its own day, as every calendar spec here has. */
let SCOPE = 'E2E calendar remind'
let WORK_DAY = day(2)

let backend: SupabaseClient
let organizationId: string

test.beforeAll(async () => {
  const project = test.info().project.name
  SCOPE = `E2E calendar ${project} remind`
  WORK_DAY = day(project === 'mobile' ? 11 : 10)

  backend = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error } = await backend.auth.signInWithPassword({
    email: EMAIL as string,
    password: PASSWORD as string,
  })
  if (error) throw new Error(`reminder fixtures could not sign in: ${error.message}`)

  const { data: orgs } = await backend.from('organizations').select('id')
  organizationId = (orgs ?? [])[0]?.id as string
  if (!organizationId) throw new Error('reminder fixtures found no organization')

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
  await backend.auth.signOut({ scope: 'local' })
})

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

const eventNamed = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(title) })

/** What the database holds for one event. */
async function reminderOf(id: string): Promise<number | null | undefined> {
  const { data } = await backend.from('calendar_events').select('reminder_minutes').eq('id', id)
  return (data ?? [])[0]?.reminder_minutes as number | null | undefined
}

async function idOf(title: string): Promise<string> {
  const { data } = await backend.from('calendar_events').select('id').eq('title', title)
  const id = (data ?? [])[0]?.id as string | undefined
  if (!id) throw new Error(`no event called ${title}`)
  return id
}

test.describe('setting one', () => {
  test('offers the seven times, and asks for none of them by default', async ({ page }) => {
    await goToMonth(page)
    await page.getByRole('button', { name: 'New event' }).click()

    const dialog = page.getByRole('dialog')
    const reminder = dialog.getByLabel('Reminder')
    await expect(reminder).toBeVisible()
    // Nothing is scheduled with a reminder unless somebody asks for one.
    await expect(reminder).toHaveText('No reminder')

    await reminder.click()
    for (const option of [
      'No reminder',
      'At the time it starts',
      '5 minutes before',
      '15 minutes before',
      '30 minutes before',
      '1 hour before',
      '1 day before',
    ]) {
      await expect(page.getByRole('option', { name: option, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('option')).toHaveCount(7)
    await page.keyboard.press('Escape')
  })

  test('creates an event with one, and the detail says when', async ({ page }) => {
    const title = `${SCOPE} with`
    await goToMonth(page)
    await page.getByRole('button', { name: `Open ${WORK_DAY}` }).click()
    await page.getByRole('button', { name: 'New event' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByLabel('Reminder').click()
    await page.getByRole('option', { name: '15 minutes before', exact: true }).click()
    await dialog.getByRole('button', { name: 'Create event' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    // Stored as minutes, not as a sentence.
    expect(await reminderOf(await idOf(title))).toBe(15)

    await eventNamed(page, title).first().click()
    await expect(page.getByRole('dialog').getByText('15 minutes before')).toBeVisible()
  })

  test('creates one without, and the detail says nothing about it', async ({ page }) => {
    const title = `${SCOPE} without`
    await goToMonth(page)
    await page.getByRole('button', { name: `Open ${WORK_DAY}` }).click()
    await page.getByRole('button', { name: 'New event' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByRole('button', { name: 'Create event' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    expect(await reminderOf(await idOf(title))).toBeNull()

    await eventNamed(page, title).first().click()
    const detail = page.getByRole('dialog')
    await expect(detail.getByRole('heading', { name: title })).toBeVisible()
    await expect(detail.getByText(/reminder|minutes before|hour before|day before/i)).toHaveCount(0)
  })

  test('changes one, and takes it away again', async ({ page }) => {
    const title = `${SCOPE} edited`
    const { data: id, error } = await backend.rpc('create_calendar_event', {
      p_organization_id: organizationId,
      p_title: title,
      p_starts_at: `${WORK_DAY}T13:00:00.000Z`,
      p_ends_at: `${WORK_DAY}T15:00:00.000Z`,
      p_timezone: 'Asia/Jakarta',
      p_event_type: 'scrim',
      p_reminder_minutes: 15,
    })
    expect(error).toBeNull()

    await goToMonth(page)
    await eventNamed(page, title).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click()

    // The form opens on what the event actually has.
    const form = page.getByRole('dialog')
    await expect(form.getByLabel('Reminder')).toHaveText('15 minutes before')

    await form.getByLabel('Reminder').click()
    await page.getByRole('option', { name: '30 minutes before', exact: true }).click()
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    expect(await reminderOf(id as string)).toBe(30)

    // And away again, which is a real change rather than a field left alone.
    await eventNamed(page, title).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('dialog').getByLabel('Reminder').click()
    await page.getByRole('option', { name: 'No reminder', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    expect(await reminderOf(id as string)).toBeNull()

    await eventNamed(page, title).first().click()
    await expect(page.getByRole('dialog').getByText('30 minutes before')).toHaveCount(0)
  })
})

test.describe('being reminded', () => {
  test('a reminder that has come due reaches the bell', async ({ page }) => {
    // Fifteen minutes out with a fifteen-minute reminder: due this second.
    const title = `${SCOPE} due`
    const starts = new Date(Date.now() + 15 * 60_000)
    const { data: id, error } = await backend.rpc('create_calendar_event', {
      p_organization_id: organizationId,
      p_title: title,
      p_starts_at: starts.toISOString(),
      p_ends_at: new Date(starts.getTime() + 3_600_000).toISOString(),
      p_timezone: 'Asia/Jakarta',
      p_event_type: 'scrim',
      p_reminder_minutes: 15,
    })
    expect(error).toBeNull()

    await page.goto('/#/calendar')
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible({
      timeout: 20_000,
    })

    // The routine a scheduler would call, called here instead. Nothing waits.
    // Its return value is not asserted: the other Playwright project is
    // calling the same routine against the same organization, and whichever
    // gets there first delivers both projects' reminders. What must be true is
    // about this event, and it is true whoever ran the routine.
    const delivered = async () => {
      const { data } = await backend
        .from('notifications')
        .select('id, recipient_id, type, summary')
        .eq('type', 'calendar_reminder')
        .eq('entity_id', id as string)
      return data ?? []
    }

    await backend.rpc('deliver_due_calendar_reminders', {})
    const rows = await delivered()
    expect(rows, 'the reminder was not delivered').toHaveLength(1)
    expect(rows[0]?.summary).toContain('starts in 15 minutes')

    // And running it again does not give this event a second one.
    await backend.rpc('deliver_due_calendar_reminders', {})
    expect(await delivered()).toHaveLength(1)

    // The existing bell, with no calendar panel of its own: it is the same
    // list the mentions use, and the row is a link to the calendar.
    await page.reload()
    await page.getByRole('button', { name: /Notifications/ }).click()
    const panel = page.getByRole('list', { name: 'Notifications' })
    // Newest first, and `.first()` because a previous run of this spec left a
    // notification with the same wording: they can be marked read but not
    // deleted, so the bell accumulates them and the test must not care.
    const row = panel.getByText(new RegExp(`${title} starts in 15 minutes`)).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    const link = panel.getByRole('link').filter({ hasText: title }).first()
    await expect(link).toHaveAttribute('href', /#\/calendar$/)

    // Leave the bell as it was found: the row cannot be deleted — the table
    // has no DELETE policy — so the most a test can do is mark it read.
    await page.keyboard.press('Escape')
    await backend.rpc('mark_notifications_read', {
      p_ids: rows.map((row) => row.id as number),
    })
  })
})

test.describe('narrow screens', () => {
  for (const width of [390, 412]) {
    test(`fits the reminder field at ${String(width)}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await goToMonth(page)
      await page.getByRole('button', { name: 'New event' }).click()

      const dialog = page.getByRole('dialog')
      const reminder = dialog.getByLabel('Reminder')
      await reminder.scrollIntoViewIfNeeded()
      await expect(reminder).toBeVisible()

      const overflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflowing, `${String(width)}px`).toBe(false)

      // The dropdown itself opens inside the viewport rather than off the edge.
      await reminder.click()
      await expect(page.getByRole('option', { name: '1 day before', exact: true })).toBeVisible()
      const spilling = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(spilling, `${String(width)}px with the list open`).toBe(false)
    })
  }
})
