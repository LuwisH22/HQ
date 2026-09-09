import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The calendar seen by somebody who may only look at it.
 *
 * Every other calendar spec runs as the owner, who implicitly holds every
 * permission there is — which proves that the routines let the right person
 * through, and nothing at all about whether they stop anybody. This one runs
 * as a member holding `calendar.view` and nothing else, and asserts the
 * refusals: not that the buttons are hidden, but that the database says no to
 * the same calls the buttons would have made.
 *
 * It needs a second identity, which cannot be conjured here: hosted signups
 * are closed and no service-role key exists in this repository (deliberately —
 * `assert:no-secrets` fails the build if one appears). The repository's own
 * mechanism for one is `supabase/seed/seed.sql`, which seeds five members
 * beside the owner on a local stack; `player@lfg.test` holds exactly
 * `calendar.view`, because the `player` role is granted only that in
 * `20250901000200_permissions_catalog.sql`.
 *
 * So point the run at a stack that has one:
 *
 *   npx supabase start && npx supabase db reset      # needs Docker
 *   # .env.e2e
 *   E2E_RESTRICTED_EMAIL=player@lfg.test
 *   E2E_RESTRICTED_PASSWORD=LfgHq!Dev2025
 *
 * Without those two variables the file skips, loudly, rather than pretending
 * the refusals were checked.
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
const OWNER_EMAIL = env.E2E_EMAIL
const OWNER_PASSWORD = env.E2E_PASSWORD
const EMAIL = env.E2E_RESTRICTED_EMAIL
const PASSWORD = env.E2E_RESTRICTED_PASSWORD
const URL = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY

test.skip(
  !EMAIL || !PASSWORD || !OWNER_EMAIL || !OWNER_PASSWORD || !URL || !KEY,
  'Set E2E_RESTRICTED_EMAIL / E2E_RESTRICTED_PASSWORD (see the note at the top of this file) to check what a view-only member is refused.',
)

/** No borrowed session: this file signs in as somebody else entirely. */
test.use({ storageState: { cookies: [], origins: [] } })
test.describe.configure({ mode: 'serial' })

const NEXT_MONTH = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1))
const YEAR = NEXT_MONTH.getUTCFullYear()
const MONTH = String(NEXT_MONTH.getUTCMonth() + 1).padStart(2, '0')
const MONTH_TITLE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
}).format(NEXT_MONTH)

/** Owner-made, restricted-read: 13:00 UTC is the same day in every zone here. */
let TITLE = 'E2E calendar authz'
let DAY = `${String(YEAR)}-${MONTH}-27`

let owner: SupabaseClient
let restricted: SupabaseClient
let eventId = ''

test.beforeAll(async () => {
  const testInfo = test.info()
  TITLE = `E2E calendar ${testInfo.project.name} authz scrim`
  DAY = `${String(YEAR)}-${MONTH}-${testInfo.project.name === 'mobile' ? '28' : '27'}`

  owner = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error: ownerError } = await owner.auth.signInWithPassword({
    email: OWNER_EMAIL as string,
    password: OWNER_PASSWORD as string,
  })
  if (ownerError) throw new Error(`the owner could not sign in: ${ownerError.message}`)

  restricted = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error: memberError } = await restricted.auth.signInWithPassword({
    email: EMAIL as string,
    password: PASSWORD as string,
  })
  if (memberError)
    throw new Error(`the restricted member could not sign in: ${memberError.message}`)

  await sweep()

  const { data: orgs } = await owner.from('organizations').select('id')
  const organizationId = (orgs ?? [])[0]?.id as string | undefined
  if (!organizationId) throw new Error('no organization to schedule in')

  const { data, error } = await owner.rpc('create_calendar_event', {
    p_organization_id: organizationId,
    p_title: TITLE,
    p_starts_at: `${DAY}T13:00:00.000Z`,
    p_ends_at: `${DAY}T15:00:00.000Z`,
    p_all_day: false,
    p_timezone: 'Asia/Jakarta',
    p_event_type: 'scrim',
    p_location: 'Practice room',
  })
  if (error) throw new Error(`fixture failed: ${error.message}`)
  eventId = data as string
})

async function sweep(): Promise<void> {
  const { data } = await owner.from('calendar_events').select('id').like('title', `${TITLE}%`)
  for (const row of data ?? []) {
    await owner.rpc('delete_calendar_event', { p_event_id: row.id })
  }
}

test.afterAll(async () => {
  if (!owner) return
  await sweep()
  // Local scope: the default would revoke the session every other spec is
  // sharing at the time.
  await owner.auth.signOut({ scope: 'local' })
})

/** Sign in as the restricted member, in this browser, through the real form. */
async function signIn(page: Page): Promise<void> {
  await page.goto('/#/auth/sign-in')
  await page.getByLabel('Email').fill(EMAIL as string)
  await page.getByLabel('Password').fill(PASSWORD as string)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Still up/ }),
  ).toBeVisible({ timeout: 20_000 })
}

/** Walk to the month the fixture is in. */
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

test.describe('a member who may only look', () => {
  test('can read the calendar, which is the permission they do hold', async ({ page }) => {
    await signIn(page)
    await goToFixtureMonth(page)

    await expect(page.getByRole('button', { name: new RegExp(TITLE) })).toBeVisible({
      timeout: 15_000,
    })
    // Reading is a table read under RLS, so this also proves the view policy
    // lets a plain member through rather than only the owner.
    const { data, error } = await restricted.from('calendar_events').select('id').eq('id', eventId)
    expect(error).toBeNull()
    expect(data?.length).toBe(1)
  })

  test('is not offered a way to add to it, or to change what is there', async ({ page }) => {
    await signIn(page)
    await goToFixtureMonth(page)

    await expect(page.getByRole('button', { name: 'New event' })).toHaveCount(0)

    await page.getByRole('button', { name: new RegExp(TITLE) }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: TITLE })).toBeVisible()
    // The detail opens, and stops there.
    await expect(dialog.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  })

  test('is refused by the database when it asks anyway', async () => {
    const { data: orgs } = await restricted.from('organizations').select('id')
    const organizationId = (orgs ?? [])[0]?.id as string

    // Creating: the button was never there, but the routine is a public
    // endpoint and this is a signed-in member of the organization asking it.
    const { error: createError } = await restricted.rpc('create_calendar_event', {
      p_organization_id: organizationId,
      p_title: `${TITLE} smuggled`,
      p_starts_at: `${DAY}T09:00:00.000Z`,
      p_ends_at: `${DAY}T10:00:00.000Z`,
    })
    expect(createError).toBeTruthy()
    expect(createError?.message).toContain('permission')

    // Editing somebody else's event.
    const { error: updateError } = await restricted.rpc('update_calendar_event', {
      p_event_id: eventId,
      p_title: `${TITLE} rewritten`,
    })
    expect(updateError).toBeTruthy()
    expect(updateError?.message).toContain('permission')

    // And deleting it.
    const { error: deleteError } = await restricted.rpc('delete_calendar_event', {
      p_event_id: eventId,
    })
    expect(deleteError).toBeTruthy()
    expect(deleteError?.message).toContain('permission')
  })

  test('changed nothing, in the end', async () => {
    const { data } = await owner
      .from('calendar_events')
      .select('title, starts_at, location')
      .eq('id', eventId)
    const row = (data ?? [])[0] as
      { title: string; starts_at: string; location: string } | undefined

    expect(row?.title).toBe(TITLE)
    expect(row?.location).toBe('Practice room')
    expect(new Date(row?.starts_at ?? 0).toISOString()).toBe(`${DAY}T13:00:00.000Z`)

    // And nothing was smuggled in beside it.
    const { data: smuggled } = await owner
      .from('calendar_events')
      .select('id')
      .eq('title', `${TITLE} smuggled`)
    expect(smuggled?.length ?? 0).toBe(0)
  })

  test('cannot reach the calendar of an organization it is not in', async () => {
    // A member of one organization asking for another's window: RLS answers
    // with no rows rather than with an error, which is the shape a leak would
    // have to break.
    const { data, error } = await restricted
      .from('calendar_events')
      .select('id')
      .eq('organization_id', '00000000-0000-4000-8000-000000000000')
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBe(0)
  })
})

test.describe('what a view-only member sees arrive', () => {
  test('the calendar updates live, because reading is the one thing they may do', async ({
    page,
  }) => {
    await signIn(page)
    await goToFixtureMonth(page)

    const title = `${TITLE} live`
    const { data: id, error } = await owner.rpc('create_calendar_event', {
      p_organization_id: (await owner.from('organizations').select('id')).data?.[0]?.id as string,
      p_title: title,
      p_starts_at: `${DAY}T09:00:00.000Z`,
      p_ends_at: `${DAY}T10:00:00.000Z`,
      p_all_day: false,
      p_timezone: 'Asia/Jakarta',
      p_event_type: 'scrim',
    })
    expect(error).toBeNull()

    // Nobody touched this browser: `calendar.view` is enough to be told.
    await expect(page.getByRole('button', { name: new RegExp(title) }).first()).toBeVisible({
      timeout: 20_000,
    })

    await owner.rpc('delete_calendar_event', { p_event_id: id as string })
    await expect(page.getByRole('button', { name: new RegExp(title) })).toHaveCount(0, {
      timeout: 20_000,
    })
  })
})
