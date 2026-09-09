import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Events that share an hour, sharing the width instead of each other's pixels.
 *
 * The grid used to place every timed event at the full width of its day, so
 * two events at the same time were drawn one on top of the other and neither
 * was readable. What follows measures the boxes: overlapping events must not
 * overlap horizontally, adjacent ones must each keep the whole column, and
 * nothing may escape the day it belongs to.
 *
 * Geometry rather than screenshots, because a screenshot says "this changed"
 * and a bounding box says "these two are not on top of each other".
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
  'Set E2E_EMAIL / E2E_PASSWORD and the Supabase env to run the calendar collision specs.',
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

/**
 * Desktop and mobile run this file at once against one database, so each takes
 * its own two days and its own titles. Two days, because "Monday cannot change
 * Tuesday's widths" needs a Tuesday.
 */
let SCOPE = 'E2E collide'
let MAIN = day(13)
let NEXT = day(14)

let backend: SupabaseClient
let organizationId: string

test.beforeAll(async () => {
  const project = test.info().project.name
  SCOPE = `E2E collide ${project}`
  MAIN = day(project === 'mobile' ? 15 : 13)
  NEXT = day(project === 'mobile' ? 16 : 14)

  backend = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error } = await backend.auth.signInWithPassword({
    email: EMAIL as string,
    password: PASSWORD as string,
  })
  if (error) throw new Error(`collision fixtures could not sign in: ${error.message}`)

  const { data: orgs } = await backend.from('organizations').select('id')
  organizationId = (orgs ?? [])[0]?.id as string
  if (!organizationId) throw new Error('collision fixtures found no organization')
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

/** 'HH' or 'HH:MM' → a full instant on that day, in UTC. */
const clock = (at: string) => (at.includes(':') ? `${at}:00` : `${at}:00:00`)

async function schedule(what: string, on: string, from: string, to: string): Promise<string> {
  const title = `${SCOPE} ${what}`
  const { error } = await backend.rpc('create_calendar_event', {
    p_organization_id: organizationId,
    p_title: title,
    p_starts_at: `${on}T${clock(from)}.000Z`,
    p_ends_at: `${on}T${clock(to)}.000Z`,
    p_all_day: false,
    p_timezone: 'UTC',
    p_event_type: 'scrim',
  })
  if (error) throw new Error(`could not schedule ${title}: ${error.message}`)
  return title
}

/** Walk to the month these tests work in, then open the day, then the view. */
async function go(page: Page, view: 'Week' | 'Day', on = MAIN): Promise<void> {
  await page.goto('/#/calendar')
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible({
    timeout: 20_000,
  })

  const switcher = page.getByRole('group', { name: 'Calendar view' })
  // The hash may already be right, in which case nothing remounted and the
  // view is whatever the last test left it on.
  await switcher.getByRole('button', { name: 'Month' }).click()

  const title = page.getByRole('heading', { level: 2 })
  for (let i = 0; i < 4; i += 1) {
    if ((await title.textContent())?.includes(MONTH_TITLE)) break
    await page.getByRole('button', { name: 'Next month' }).click()
  }
  await page.getByRole('button', { name: `Open ${on}` }).click()
  if (view === 'Week') await switcher.getByRole('button', { name: 'Week' }).click()
}

const card = (page: Page, title: string) => page.getByRole('button', { name: new RegExp(title) })

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function boxOf(locator: Locator): Promise<Box> {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error('that event is not on screen')
  return box
}

/**
 * Several boxes, measured in one position.
 *
 * The week grid scrolls sideways on a narrow screen, so scrolling each card
 * into view in turn would measure the first one from a different scroll offset
 * than the second — and two boxes measured in two coordinate frames cannot be
 * compared. Everything compared here is in the same day column, so one scroll
 * brings all of it into view and every measurement is taken from there.
 */
async function boxesOf(locators: readonly Locator[]): Promise<Box[]> {
  const first = locators[0]
  if (first) await first.scrollIntoViewIfNeeded()

  const boxes: Box[] = []
  for (const locator of locators) {
    const box = await locator.boundingBox()
    if (!box) throw new Error('that event is not on screen')
    boxes.push(box)
  }
  return boxes
}

/** True when two boxes share any horizontal space at all. */
const sideBySide = (a: Box, b: Box) => a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5

test.describe('the week', () => {
  test('puts two overlapping events beside each other, not on top', async ({ page }) => {
    const first = await schedule('two A', MAIN, '02', '03')
    const second = await schedule('two B', MAIN, '02:30', '03:30')

    await go(page, 'Week')
    const [a, b] = await boxesOf([card(page, first), card(page, second)])

    // The whole bug, in one assertion.
    expect(sideBySide(a, b)).toBe(true)
    // And they are the same size as each other: half a column each.
    expect(Math.abs(a.width - b.width)).toBeLessThan(2)
    // Both are still readable rather than hairlines.
    expect(a.width).toBeGreaterThan(20)
  })

  test('leaves adjacent events the whole column each', async ({ page }) => {
    // Touching is not overlapping: 02–03 and 03–04 take nothing from one
    // another, and must not be split into halves for nothing.
    const first = await schedule('next A', MAIN, '02', '03')
    const second = await schedule('next B', MAIN, '03', '04')
    const alone = await schedule('alone', NEXT, '02', '03')

    await go(page, 'Week')
    const [a, b] = await boxesOf([card(page, first), card(page, second)])
    // Another day, so another scroll position; measured on its own.
    const solo = await boxOf(card(page, alone))

    expect(a.x).toBeCloseTo(b.x, 0)
    // The width an event gets when nothing else is on: the same one.
    expect(Math.abs(a.width - solo.width)).toBeLessThan(2)
  })

  test('keeps one day out of another day’s arithmetic', async ({ page }) => {
    // Three at once on the main day, one alone on the next. If the days shared
    // a collision domain the lonely one would be a third of a column wide.
    await schedule('busy A', MAIN, '02', '04')
    await schedule('busy B', MAIN, '02:30', '03:30')
    await schedule('busy C', MAIN, '02:45', '03:15')
    const alone = await schedule('quiet', NEXT, '02', '03')

    await go(page, 'Week')
    const solo = await boxOf(card(page, alone))
    const crowded = await boxOf(card(page, `${SCOPE} busy A`))

    expect(solo.width).toBeGreaterThan(crowded.width * 2)
  })

  test('never lets an event escape its own day column', async ({ page }) => {
    await schedule('inside A', MAIN, '02', '04')
    await schedule('inside B', MAIN, '02:30', '03:30')
    await schedule('inside C', MAIN, '02:45', '03:15')
    await schedule('inside D', MAIN, '03', '04')

    await go(page, 'Week')

    const boxes = await boxesOf(
      ['inside A', 'inside B', 'inside C', 'inside D'].map((what) =>
        card(page, `${SCOPE} ${what}`),
      ),
    )
    const left = Math.min(...boxes.map((one) => one.x))
    const right = Math.max(...boxes.map((one) => one.x + one.width))
    // Four events across one day column: about one column wide in total, not
    // four. A day column is never as wide as the whole grid.
    expect(right - left).toBeLessThan(400)

    // And no two of them share horizontal space unless their times do not.
    expect(sideBySide(boxes[0], boxes[1])).toBe(true)
    expect(sideBySide(boxes[1], boxes[2])).toBe(true)
  })
})

test.describe('the day', () => {
  test('lays three overlapping events out the same way the week does', async ({ page }) => {
    // The same grid draws both views, so this is one algorithm being reused
    // rather than a second one that happens to agree.
    const a = await schedule('day A', MAIN, '02', '04')
    const b = await schedule('day B', MAIN, '02:30', '03:30')
    const c = await schedule('day C', MAIN, '02:45', '03:15')

    await go(page, 'Day')
    const boxes = await boxesOf([a, b, c].map((title) => card(page, title)))

    expect(sideBySide(boxes[0], boxes[1])).toBe(true)
    expect(sideBySide(boxes[1], boxes[2])).toBe(true)
    expect(sideBySide(boxes[0], boxes[2])).toBe(true)

    // Three columns of about the same width, in start order left to right.
    expect(Math.abs((boxes[0]).width - (boxes[2]).width)).toBeLessThan(2)
    expect((boxes[0]).x).toBeLessThan((boxes[1]).x)
    expect((boxes[1]).x).toBeLessThan((boxes[2]).x)
  })

  test('lets an event take the width back when the one before it has ended', async ({ page }) => {
    // A overlaps B, B overlaps C, A does not overlap C. C belongs in A's
    // column: the group needs two columns, not three.
    const a = await schedule('chain A', MAIN, '02', '03')
    const b = await schedule('chain B', MAIN, '02:30', '03:30')
    const c = await schedule('chain C', MAIN, '03', '04')

    await go(page, 'Day')
    const [first, second, third] = await boxesOf([a, b, c].map((title) => card(page, title)))

    expect((first).x).toBeCloseTo((third).x, 0)
    expect(sideBySide(first, second)).toBe(true)
    expect(sideBySide(second, third)).toBe(true)
    // Two columns: each about half of what one event alone would get.
    expect(Math.abs((first).width - (third).width)).toBeLessThan(2)
  })

  test('keeps a long event beside the short ones inside it', async ({ page }) => {
    const long = await schedule('long', MAIN, '02', '08')
    const short = await schedule('short', MAIN, '03', '04')
    const later = await schedule('later', MAIN, '05', '06')

    await go(page, 'Day')
    const [big, one, two] = await boxesOf(
      [long, short, later].map((title) => card(page, title)),
    )

    // Two columns, not three: the short ones do not overlap each other.
    expect(sideBySide(big, one)).toBe(true)
    expect((one).x).toBeCloseTo((two).x, 0)
    expect(Math.abs((one).width - (two).width)).toBeLessThan(2)
  })
})

/**
 * A phone.
 *
 * Seven day columns across 390 pixels leaves about forty each, and splitting
 * one in two used to leave twenty — so the grid now keeps a floor under a day
 * column and scrolls sideways inside its own container instead. What must
 * still be true is that the page itself does not scroll, and that two events
 * at the same hour are two readable cards rather than one illegible one.
 */
for (const width of [390, 412]) {
  test.describe(`${String(width)}px`, () => {
    test(`keeps overlapping events apart and readable at ${String(width)}px`, async ({ page }) => {
      const a = await schedule('narrow A', MAIN, '02', '03')
      const b = await schedule('narrow B', MAIN, '02:30', '03:30')

      await page.setViewportSize({ width, height: 844 })

      for (const view of ['Day', 'Week'] as const) {
        await go(page, view)

        const [first, second] = await boxesOf([card(page, a), card(page, b)])

        expect(sideBySide(first, second)).toBe(true)
        // Not a hairline. Twenty pixels was the old week-on-a-phone answer.
        expect(first.width).toBeGreaterThan(28)
        expect(second.width).toBeGreaterThan(28)

        // The grid may scroll sideways; the page may not.
        const overflowing = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        )
        expect(overflowing).toBe(false)

        // And nothing has escaped to the left of the hour gutter.
        expect(first.x).toBeGreaterThan(0)
      }
    })
  })
}
