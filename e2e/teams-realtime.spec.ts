import { expect, test, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Teams keeping themselves current.
 *
 * Every assertion waits for a real Supabase Realtime event to travel from a
 * second client — either another browser window driving the actual interface,
 * or a signed-in client calling the same routines the interface calls — to a
 * page nobody has touched. Nothing here invokes an invalidation by hand: a
 * test that did would pass with the subscription deleted.
 *
 * The second client is the same account, because it is the only credential
 * this environment has. What delivery depends on is two sockets, not two
 * people; what it would take to prove the negative case — a member who may not
 * see this team — is a second identity with a narrower role, which is stated
 * rather than faked. `scripts/verify-teams-realtime.mjs` makes the one
 * negative case that is available: an anonymous socket.
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
  'Set E2E_EMAIL / E2E_PASSWORD and the Supabase env to run the team realtime specs.',
)

const STORAGE = '.auth/owner.json'
test.use({ storageState: STORAGE })

/** One worker: these tests write rows a watching page is waiting for. */
test.describe.configure({ mode: 'serial' })

let SCOPE = 'E2E live team'
let RUN = '0000'

let backend: SupabaseClient
let organizationId: string
let membershipId: string

test.beforeAll(async () => {
  SCOPE = `E2E live team ${test.info().project.name}`
  RUN = Date.now().toString(36).slice(-4)

  backend = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error } = await backend.auth.signInWithPassword({
    email: EMAIL as string,
    password: PASSWORD as string,
  })
  if (error) throw new Error(`realtime fixtures could not sign in: ${error.message}`)

  const { data: orgs } = await backend.from('organizations').select('id')
  organizationId = (orgs ?? [])[0]?.id as string
  if (!organizationId) throw new Error('realtime fixtures found no organization')

  const { data: members } = await backend
    .from('organization_members')
    .select('id')
    .eq('organization_id', organizationId)
    .limit(1)
  membershipId = members?.[0]?.id as string
  await sweep()
})

async function sweep(): Promise<void> {
  const { data } = await backend.from('teams').select('id, archived_at').like('name', `${SCOPE}%`)
  for (const row of data ?? []) {
    if (row.archived_at === null) await backend.rpc('archive_team', { p_team_id: row.id })
  }
}

test.afterAll(async () => {
  if (!backend) return
  await sweep()
  // Local scope: the default would revoke the session the other Playwright
  // project is sharing at the time.
  await backend.auth.signOut({ scope: 'local' })
})

async function makeTeam(what: string): Promise<string> {
  const { data, error } = await backend.rpc('create_team', {
    p_organization_id: organizationId,
    p_name: `${SCOPE} ${what} ${RUN}`,
    p_description: 'Watched by a test.',
  })
  if (error) throw new Error(`could not create ${what}: ${error.message}`)
  return data as string
}

async function watch(page: Page, teamId: string, name: string): Promise<void> {
  await page.goto(`/#/teams/${teamId}`)
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 20_000 })
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

test.describe('two windows on one team', () => {
  test('follows a rename, an archive and a restore without anybody refreshing', async ({
    page,
    browser,
  }) => {
    const id = await makeTeam('together')
    const watcher = page
    const actor = await secondWindow(browser, page)

    try {
      await watch(watcher, id, `${SCOPE} together ${RUN}`)
      await watch(actor, id, `${SCOPE} together ${RUN}`)

      // --- renamed, through the actual interface ------------------------
      const renamed = `${SCOPE} renamed ${RUN}`
      await actor.getByRole('button', { name: 'Edit', exact: true }).click()
      await actor.getByRole('dialog').getByLabel('Name').fill(renamed)
      await actor.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click()
      await expect(actor.getByRole('heading', { name: 'Edit team' })).toHaveCount(0, {
        timeout: 15_000,
      })

      // The watcher was never touched: no navigation, no reload, no click.
      await expect(watcher.getByRole('heading', { name: renamed, level: 1 })).toBeVisible({
        timeout: 20_000,
      })

      // --- archived ------------------------------------------------------
      await actor.getByRole('button', { name: 'Archive' }).click()
      await actor.getByRole('dialog').getByRole('button', { name: 'Archive team' }).click()
      await expect(actor.getByRole('heading', { name: /^Archive/ })).toHaveCount(0, {
        timeout: 15_000,
      })

      // And the watcher's controls follow the state, not just its badge.
      await expect(watcher.getByText('Archived', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(watcher.getByRole('button', { name: 'Restore team' })).toBeVisible()
      await expect(watcher.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
      await expect(watcher.getByRole('button', { name: 'Add member' })).toHaveCount(0)

      // --- restored -------------------------------------------------------
      await actor.getByRole('button', { name: 'Restore team' }).click()
      await expect(actor.getByRole('button', { name: 'Edit', exact: true })).toBeVisible({
        timeout: 15_000,
      })

      await expect(watcher.getByRole('button', { name: 'Add member' })).toBeVisible({
        timeout: 20_000,
      })
      await expect(watcher.getByText('Archived', { exact: true })).toHaveCount(0)
    } finally {
      await actor.context().close()
    }
  })

  test('follows a roster filling, changing and emptying', async ({ page }) => {
    const id = await makeTeam('roster')
    await watch(page, id, `${SCOPE} roster ${RUN}`)
    await expect(page.getByText('Nobody is on this team yet.')).toBeVisible()

    // --- somebody joins, from another client ----------------------------
    await backend.rpc('add_team_member', { p_team_id: id, p_member_id: membershipId })
    await expect(page.getByText('1 member')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Starting', { exact: true })).toBeVisible()

    // --- and their position and status change ----------------------------
    await backend.rpc('update_team_member', {
      p_team_id: id,
      p_member_id: membershipId,
      p_position: 'Duelist',
      p_status: 'substitute',
    })
    await expect(page.getByText('Duelist · Substitute')).toBeVisible({ timeout: 20_000 })
    // The count is derived from the roster, so it has to follow too.
    await expect(page.getByText('1 member · 0 starting')).toBeVisible({ timeout: 20_000 })

    // --- and they leave ---------------------------------------------------
    await backend.rpc('remove_team_member', { p_team_id: id, p_member_id: membershipId })
    await expect(page.getByText('Nobody is on this team yet.')).toBeVisible({ timeout: 20_000 })
  })

  test('closes a roster dialog when its subject is taken off elsewhere', async ({ page }) => {
    // The dialog is derived from the live roster rather than from a snapshot,
    // so somebody removed by another client cannot be left half-edited.
    const id = await makeTeam('vanishing')
    await backend.rpc('add_team_member', { p_team_id: id, p_member_id: membershipId })

    await watch(page, id, `${SCOPE} vanishing ${RUN}`)
    await page.getByRole('button', { name: /^Edit .+ roster details$/ }).click()
    await expect(page.getByRole('dialog').getByLabel('Position')).toBeVisible()

    await backend.rpc('remove_team_member', { p_team_id: id, p_member_id: membershipId })

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByText('Nobody is on this team yet.')).toBeVisible()
  })
})

test.describe('the list', () => {
  test('follows a team appearing, being archived and coming back', async ({ page }) => {
    await page.goto('/#/teams')
    await expect(page.getByRole('heading', { name: 'Teams', level: 1 })).toBeVisible({
      timeout: 20_000,
    })

    const id = await makeTeam('listed')
    const row = page.getByRole('link', { name: new RegExp(`${SCOPE} listed ${RUN}`) })
    await expect(row).toBeVisible({ timeout: 20_000 })

    // Somebody joins: the row draws a count and a face from the roster.
    await backend.rpc('add_team_member', { p_team_id: id, p_member_id: membershipId })
    await expect(row.getByText('1 member')).toBeVisible({ timeout: 20_000 })

    await backend.rpc('archive_team', { p_team_id: id })
    await expect(page.getByRole('heading', { name: 'Archived', level: 2 })).toBeVisible({
      timeout: 20_000,
    })
    await expect(row.getByText('Archived', { exact: true })).toBeVisible()

    await backend.rpc('restore_team', { p_team_id: id })
    await expect(row.getByText('Archived', { exact: true })).toHaveCount(0, { timeout: 20_000 })
  })
})

test.describe('a member moving between teams', () => {
  test('leaves one roster and arrives on the other, keeping what they do', async ({
    page,
    browser,
  }) => {
    const from = await makeTeam('source')
    const to = await makeTeam('target')
    await backend.rpc('add_team_member', { p_team_id: from, p_member_id: membershipId })
    await backend.rpc('update_team_member', {
      p_team_id: from,
      p_member_id: membershipId,
      p_position: 'IGL',
      p_status: 'substitute',
    })

    const watchingSource = page
    const watchingTarget = await secondWindow(browser, page)

    try {
      await watch(watchingSource, from, `${SCOPE} source ${RUN}`)
      await watch(watchingTarget, to, `${SCOPE} target ${RUN}`)

      await expect(watchingSource.getByText('IGL · Substitute')).toBeVisible({ timeout: 15_000 })
      await expect(watchingTarget.getByText('Nobody is on this team yet.')).toBeVisible()

      // One routine, two rows, two teams — and two windows that each hear only
      // about their own.
      await backend.rpc('move_team_member', {
        p_from_team_id: from,
        p_to_team_id: to,
        p_member_id: membershipId,
      })

      await expect(watchingSource.getByText('Nobody is on this team yet.')).toBeVisible({
        timeout: 20_000,
      })
      await expect(watchingTarget.getByText('IGL · Substitute')).toBeVisible({ timeout: 20_000 })
      // Nobody is on both.
      await expect(watchingSource.getByText('IGL · Substitute')).toHaveCount(0)
    } finally {
      await watchingTarget.context().close()
    }
  })
})

/**
 * A phone.
 *
 * Realtime is meant to be invisible, so what is checked here is that arriving
 * changes do not break the layout: no banner, no flash, no row that grows and
 * pushes the page sideways.
 */
for (const width of [390, 412]) {
  test.describe(`${String(width)}px`, () => {
    test(`follows changes without disturbing the layout at ${String(width)}px`, async ({
      page,
    }) => {
      const id = await makeTeam(`narrow ${String(width)}`)
      await page.setViewportSize({ width, height: 844 })
      await watch(page, id, `${SCOPE} narrow ${String(width)} ${RUN}`)

      const overflows = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        )

      expect(await overflows()).toBe(false)

      await backend.rpc('add_team_member', { p_team_id: id, p_member_id: membershipId })
      await expect(page.getByText('1 member')).toBeVisible({ timeout: 20_000 })
      expect(await overflows()).toBe(false)

      await backend.rpc('update_team_member', {
        p_team_id: id,
        p_member_id: membershipId,
        p_position: 'Controller',
        p_status: 'substitute',
      })
      await expect(page.getByText('Controller · Substitute')).toBeVisible({ timeout: 20_000 })
      expect(await overflows()).toBe(false)

      await backend.rpc('archive_team', { p_team_id: id })
      await expect(page.getByText('Archived', { exact: true })).toBeVisible({ timeout: 20_000 })
      expect(await overflows()).toBe(false)

      // Nothing shouts about any of it: no badge, no banner, no status pill.
      // Matched as a whole word, because this team's own name contains "live".
      await expect(page.getByText(/^(live|realtime|reconnecting|connected)$/i)).toHaveCount(0)

      await backend.rpc('restore_team', { p_team_id: id })
      await expect(page.getByRole('button', { name: 'Add member' })).toBeVisible({
        timeout: 20_000,
      })
      expect(await overflows()).toBe(false)
    })
  })
}
