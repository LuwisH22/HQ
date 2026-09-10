import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Teams, through the interface.
 *
 * The thing worth watching here is the split the permission catalogue has
 * always had: configuring a team and picking who is on it are different jobs,
 * with different permissions behind them. This account holds both, so what it
 * can show is that each control works and calls the right routine; which
 * controls appear for which permission is exercised exhaustively in
 * `TeamDetailPage.test.tsx`, where a permission set can be handed in.
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
  'Set E2E_EMAIL / E2E_PASSWORD and the Supabase env to run the teams specs.',
)

test.use({ storageState: '.auth/owner.json' })
test.describe.configure({ mode: 'serial' })

/** Desktop and mobile run this file at once against one database. */
let SCOPE = 'E2E team'
let RUN = '0000'

let backend: SupabaseClient
let organizationId: string

test.beforeAll(async () => {
  SCOPE = `E2E team ${test.info().project.name}`
  RUN = Date.now().toString(36).slice(-4)

  backend = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error } = await backend.auth.signInWithPassword({
    email: EMAIL as string,
    password: PASSWORD as string,
  })
  if (error) throw new Error(`team fixtures could not sign in: ${error.message}`)

  const { data: orgs } = await backend.from('organizations').select('id')
  organizationId = (orgs ?? [])[0]?.id as string
  if (!organizationId) throw new Error('team fixtures found no organization')
  await sweep()
})

/**
 * Put away everything this project made.
 *
 * Archiving rather than deleting, because that is all the product can do —
 * 7.1 gave teams no delete routine, since teams are what rosters and results
 * will hang off. Names carry the run, so an archived leftover is never
 * mistaken for this run's work.
 */
async function sweep(): Promise<void> {
  const { data } = await backend
    .from('teams')
    .select('id, archived_at')
    .like('name', `${SCOPE}%`)
  for (const row of data ?? []) {
    if (row.archived_at === null) await backend.rpc('archive_team', { p_team_id: row.id })
  }
}

test.afterAll(async () => {
  if (!backend) return
  await sweep()
  await backend.auth.signOut({ scope: 'local' })
})

async function makeTeam(what: string): Promise<string> {
  const { data, error } = await backend.rpc('create_team', {
    p_organization_id: organizationId,
    p_name: `${SCOPE} ${what} ${RUN}`,
    p_description: 'Made by a test.',
  })
  if (error) throw new Error(`could not create ${what}: ${error.message}`)
  return data as string
}

async function goToTeams(page: Page): Promise<void> {
  await page.goto('/#/teams')
  await expect(page.getByRole('heading', { name: 'Teams', level: 1 })).toBeVisible({
    timeout: 20_000,
  })
}

async function openTeam(page: Page, teamId: string, name: string): Promise<void> {
  await page.goto(`/#/teams/${teamId}`)
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 20_000 })
}

const rowOf = async (teamId: string) => {
  const { data } = await backend
    .from('teams')
    .select('name, description, archived_at')
    .eq('id', teamId)
  return data?.[0]
}

const rosterOf = async (teamId: string) => {
  const { data } = await backend.from('team_members').select('member_id').eq('team_id', teamId)
  return (data ?? []).map((row) => row.member_id as string)
}

test.describe('finding teams', () => {
  test('is reachable from the navigation and lists what exists', async ({ page }) => {
    const id = await makeTeam('listed')
    await page.goto('/#/dashboard')

    // The row is in the navigation now that the page is real. On a phone the
    // sidebar is a drawer, so it is opened first — the entry is the same one
    // either way, and both surfaces read it from the same configuration.
    const drawer = page.getByRole('button', { name: 'Open navigation' })
    const sidebarLink = page.getByRole('link', { name: 'Teams' }).first()
    // Whichever surface this viewport has, wait for it before deciding.
    await expect(drawer.or(sidebarLink)).toBeVisible({ timeout: 20_000 })
    if (await drawer.isVisible()) await drawer.click()

    const link = page.getByRole('link', { name: 'Teams' }).first()
    await expect(link).toBeVisible({ timeout: 15_000 })
    await link.click()
    await expect(page.getByRole('heading', { name: 'Teams', level: 1 })).toBeVisible({
      timeout: 20_000,
    })

    const row = page.getByRole('link', { name: new RegExp(`${SCOPE} listed ${RUN}`) })
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row.getByText('0 members')).toBeVisible()
    // Nobody on it yet, said in words rather than by an empty space.
    await expect(row.getByText('No members yet')).toBeAttached()
    void id
  })

  test('opens one and shows what it is', async ({ page }) => {
    const id = await makeTeam('opened')
    await goToTeams(page)
    await page.getByRole('link', { name: new RegExp(`${SCOPE} opened ${RUN}`) }).click()

    await expect(page.getByRole('heading', { level: 1 })).toContainText(`${SCOPE} opened ${RUN}`)
    await expect(page.getByText('Made by a test.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Roster', level: 2 })).toBeVisible()
    void id
  })

  test('says a team is unavailable without saying whose it is', async ({ page }) => {
    await page.goto('/#/teams/00000000-0000-4000-8000-000000000000')
    await expect(page.getByText('Team unavailable')).toBeVisible({ timeout: 20_000 })
    // Never "it exists but is not yours".
    await expect(page.getByText(/permission/i)).toHaveCount(0)
  })
})

test.describe('making and changing a team', () => {
  test('creates one and goes straight to it', async ({ page }) => {
    await goToTeams(page)
    await page.getByRole('button', { name: 'New team' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'New team' })).toBeVisible()

    // The form refuses what the database would refuse.
    await dialog.getByRole('button', { name: 'Create team' }).click()
    await expect(dialog.getByText('A name is required')).toBeVisible()

    const name = `${SCOPE} created ${RUN}`
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByLabel('Description').fill('A side made through the interface.')
    await dialog.getByRole('button', { name: 'Create team' }).click()

    // Straight to the team, because the next thing anybody wants is its roster.
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Roster', level: 2 })).toBeVisible()

    const { data } = await backend.from('teams').select('id, description').eq('name', name)
    expect(data?.[0]?.description).toBe('A side made through the interface.')
  })

  test('renames one, and the list agrees', async ({ page }) => {
    const id = await makeTeam('renamable')
    await openTeam(page, id, `${SCOPE} renamable ${RUN}`)

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Edit team' })).toBeVisible()
    // Nothing to save until something changes.
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    const renamed = `${SCOPE} renamed ${RUN}`
    await dialog.getByLabel('Name').fill(renamed)
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('heading', { name: 'Edit team' })).toHaveCount(0, {
      timeout: 15_000,
    })

    await expect(page.getByRole('heading', { name: renamed, level: 1 })).toBeVisible()
    expect((await rowOf(id))?.name).toBe(renamed)

    // The list is a different query family and has to have heard about it too.
    await goToTeams(page)
    await expect(page.getByRole('link', { name: new RegExp(renamed) })).toBeVisible({
      timeout: 20_000,
    })
  })
})

test.describe('the roster', () => {
  test('adds somebody, then takes them off after asking', async ({ page }) => {
    const id = await makeTeam('rostered')
    await openTeam(page, id, `${SCOPE} rostered ${RUN}`)

    await expect(page.getByText('Nobody is on this team yet.')).toBeVisible()
    await page.getByRole('button', { name: 'Add member' }).click()

    const picker = page.getByRole('dialog')
    await expect(picker.getByRole('heading', { name: /^Add to / })).toBeVisible()

    // The candidates are this organization's own members, and nobody else.
    // Each says what it does rather than only who it is.
    const first = picker.getByRole('button', { name: /^Add .+ to / }).first()
    await expect(first).toBeVisible({ timeout: 15_000 })
    await first.click()

    await expect(picker.getByRole('heading', { name: /^Add to / })).toBeVisible()
    await picker.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('heading', { name: /^Add to / })).toHaveCount(0, {
      timeout: 15_000,
    })

    await expect(page.getByText('1 member')).toBeVisible({ timeout: 15_000 })
    expect(await rosterOf(id)).toHaveLength(1)

    // --- and off again ------------------------------------------------
    // Whoever the roster row names, rather than reconstructing it from the
    // picker: the two lists are separate reads and need not phrase a name the
    // same way, and this test is about removal rather than about naming.
    const remove = page.getByRole('button', { name: /^Remove .+ from / }).first()
    await expect(remove).toBeVisible({ timeout: 15_000 })
    await remove.click()

    const confirm = page.getByRole('dialog')
    await expect(confirm.getByRole('heading', { name: /^Remove .+ from / })).toBeVisible()
    // The wording has to make clear what is *not* happening.
    await expect(confirm.getByText(/does not remove them from LFG HQ/i)).toBeVisible()

    await confirm.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByRole('heading', { name: /^Remove .* from / })).toHaveCount(0, {
      timeout: 15_000,
    })

    await expect(page.getByText('Nobody is on this team yet.')).toBeVisible({ timeout: 15_000 })
    expect(await rosterOf(id)).toHaveLength(0)

    // And they are still in the organization, which is the whole point.
    const { data: members } = await backend
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
    expect((members ?? []).length).toBeGreaterThan(0)
  })

  test('does not offer somebody already on the team', async ({ page }) => {
    const id = await makeTeam('deduped')
    const { data: members } = await backend
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
    await backend.rpc('add_team_member', {
      p_team_id: id,
      p_member_id: members?.[0]?.id as string,
    })

    await openTeam(page, id, `${SCOPE} deduped ${RUN}`)
    // Whoever is on it already, taken from the Remove control that names them.
    const removeLabel =
      (await page
        .getByRole('button', { name: /^Remove .+ from / })
        .first()
        .getAttribute('aria-label')) ?? ''
    const onIt = removeLabel.replace(/^Remove /, '').replace(/ from .*$/, '')

    await expect(page.getByText('1 member')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Add member' }).click()
    const picker = page.getByRole('dialog')
    // Whoever is left, the one already on it is not among them.
    await expect(picker.getByRole('heading', { name: /^Add to / })).toBeVisible()
    const offered = picker.getByRole('button', { name: /^Add .+ to / })
    for (const candidate of await offered.all()) {
      const label = (await candidate.getAttribute('aria-label')) ?? ''
      expect(label).not.toContain(onIt)
    }
    await picker.getByRole('button', { name: 'Done' }).click()
    expect(await rosterOf(id)).toHaveLength(1)
  })
})

test.describe('archiving', () => {
  test('puts a team away with its roster, and brings it back', async ({ page }) => {
    const id = await makeTeam('archivable')
    const { data: members } = await backend
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
    await backend.rpc('add_team_member', {
      p_team_id: id,
      p_member_id: members?.[0]?.id as string,
    })

    await openTeam(page, id, `${SCOPE} archivable ${RUN}`)
    await page.getByRole('button', { name: 'Archive' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /^Archive/ })).toBeVisible()
    await expect(dialog.getByText(/roster changes and editing are unavailable/i)).toBeVisible()
    await dialog.getByRole('button', { name: 'Archive team' }).click()
    await expect(page.getByRole('heading', { name: /^Archive/ })).toHaveCount(0, {
      timeout: 15_000,
    })

    expect((await rowOf(id))?.archived_at).not.toBeNull()

    // Said in a word — the badge, not the date line beside it and not the
    // toast — and everything that would be refused is gone.
    await expect(page.getByText('Archived', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add member' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
    // The roster is still readable — archived is not deleted.
    await expect(page.getByText('1 member')).toBeVisible()

    await page.getByRole('button', { name: 'Restore team' }).click()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible({
      timeout: 15_000,
    })

    const back = await rowOf(id)
    expect(back?.archived_at).toBeNull()
    // The same team, with the same people. Nothing recreated.
    expect(await rosterOf(id)).toHaveLength(1)
    await expect(page.getByRole('button', { name: 'Add member' })).toBeVisible()
  })

  test('groups archived teams below the active ones', async ({ page }) => {
    const id = await makeTeam('grouped')
    await backend.rpc('archive_team', { p_team_id: id })

    await goToTeams(page)
    await expect(page.getByRole('heading', { name: 'Archived', level: 2 })).toBeVisible({
      timeout: 20_000,
    })
    const row = page.getByRole('link', { name: new RegExp(`${SCOPE} grouped ${RUN}`) })
    await expect(row).toBeVisible()
    await expect(row.getByText('Archived', { exact: true })).toBeVisible()
  })
})

/**
 * A phone.
 *
 * The list, the roster and three dialogs all have to fit, and the thing most
 * likely to break is a confirmation that puts its buttons off the edge — so
 * each one is opened and its controls are asked whether they are actually
 * reachable rather than merely present.
 */
for (const width of [390, 412]) {
  test.describe(`${String(width)}px`, () => {
    test(`keeps teams usable at ${String(width)}px`, async ({ page }) => {
      const id = await makeTeam(`narrow ${String(width)}`)
      await page.setViewportSize({ width, height: 844 })

      const overflows = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        )

      // --- the list -------------------------------------------------------
      await goToTeams(page)
      const row = page.getByRole('link', { name: new RegExp(`narrow ${String(width)} ${RUN}`) })
      await expect(row).toBeVisible({ timeout: 20_000 })
      expect(await overflows()).toBe(false)

      // --- the team -------------------------------------------------------
      await row.click()
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        `narrow ${String(width)} ${RUN}`,
      )
      await expect(page.getByRole('heading', { name: 'Roster', level: 2 })).toBeVisible()
      expect(await overflows()).toBe(false)

      // --- adding somebody ------------------------------------------------
      const add = page.getByRole('button', { name: 'Add member' })
      await add.scrollIntoViewIfNeeded()
      await add.click()
      const picker = page.getByRole('dialog')
      await expect(picker.getByLabel('Search members')).toBeVisible()
      await expect(picker.getByRole('button', { name: 'Done' })).toBeVisible()
      expect(await overflows()).toBe(false)
      await picker.getByRole('button', { name: 'Done' }).click()

      // --- the roster dialogs ---------------------------------------------
      // Somebody has to be on it for these to exist at all.
      const { data: members } = await backend
        .from('organization_members')
        .select('id')
        .eq('organization_id', organizationId)
        .limit(1)
      await backend.rpc('add_team_member', {
        p_team_id: id,
        p_member_id: members?.[0]?.id as string,
      })
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Roster', level: 2 })).toBeVisible({
        timeout: 20_000,
      })

      const rosterEdit = page.getByRole('button', { name: /^Edit .+ roster details$/ })
      await rosterEdit.scrollIntoViewIfNeeded()
      await rosterEdit.click()
      const roster = page.getByRole('dialog')
      await expect(roster.getByLabel('Position')).toBeVisible()
      await expect(roster.getByLabel('Status')).toBeVisible()
      await expect(roster.getByRole('button', { name: 'Cancel' })).toBeVisible()
      expect(await overflows()).toBe(false)
      await roster.getByRole('button', { name: 'Cancel' }).click()

      const move = page.getByRole('button', { name: /^Move .+ to another team$/ })
      if (await move.isVisible()) {
        await move.click()
        const moving = page.getByRole('dialog')
        await expect(moving.getByRole('heading', { name: /^Move / })).toBeVisible()
        await expect(moving.getByRole('button', { name: 'Cancel' })).toBeVisible()
        expect(await overflows()).toBe(false)
        await moving.getByRole('button', { name: 'Cancel' }).click()
      }

      // --- removing --------------------------------------------------------
      const remove = page.getByRole('button', { name: /^Remove .+ from / })
      await remove.scrollIntoViewIfNeeded()
      await remove.click()
      const removal = page.getByRole('dialog')
      await expect(removal.getByRole('button', { name: 'Remove', exact: true })).toBeVisible()
      expect(await overflows()).toBe(false)
      await removal.getByRole('button', { name: 'Cancel' }).click()

      // --- editing the team ------------------------------------------------
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      const editor = page.getByRole('dialog')
      await expect(editor.getByLabel('Name')).toBeVisible()
      await expect(editor.getByRole('button', { name: 'Cancel' })).toBeVisible()
      expect(await overflows()).toBe(false)
      await editor.getByRole('button', { name: 'Cancel' }).click()

      // --- archiving ------------------------------------------------------
      await page.getByRole('button', { name: 'Archive' }).click()
      const confirm = page.getByRole('dialog')
      await expect(confirm.getByRole('button', { name: 'Archive team' })).toBeVisible()
      await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeVisible()
      expect(await overflows()).toBe(false)
      await confirm.getByRole('button', { name: 'Archive team' }).click()

      await expect(page.getByRole('button', { name: 'Restore team' })).toBeVisible({
        timeout: 15_000,
      })
      expect(await overflows()).toBe(false)
      void id
    })
  })
}

test.describe('what somebody does on a team', () => {
  test('sets a position and a status, and shows them on the roster', async ({ page }) => {
    const id = await makeTeam('operational')
    const { data: members } = await backend
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
    await backend.rpc('add_team_member', {
      p_team_id: id,
      p_member_id: members?.[0]?.id as string,
    })

    await openTeam(page, id, `${SCOPE} operational ${RUN}`)
    // Everybody starts playing, with nothing said about what they do.
    await expect(page.getByText('Starting', { exact: true })).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /^Edit .+ roster details$/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/changes nothing about their account/i)).toBeVisible()
    // Nothing to save until something changes.
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()

    await dialog.getByLabel('Position').fill('Duelist')
    await dialog.getByLabel('Status').click()
    await page.getByRole('option', { name: 'Substitute' }).click()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    // Read back on the row, in words rather than by colour.
    await expect(page.getByText('Duelist · Substitute')).toBeVisible({ timeout: 15_000 })
    // And the count now says how many are actually playing.
    await expect(page.getByText('1 member · 0 starting')).toBeVisible()

    const { data: row } = await backend
      .from('team_members')
      .select('roster_position, roster_status')
      .eq('team_id', id)
      .eq('member_id', members?.[0]?.id as string)
    expect(row?.[0]?.roster_position).toBe('Duelist')
    expect(row?.[0]?.roster_status).toBe('substitute')
  })

  test('takes a position off again', async ({ page }) => {
    const id = await makeTeam('clearable')
    const { data: members } = await backend
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
    const memberId = members?.[0]?.id as string
    await backend.rpc('add_team_member', { p_team_id: id, p_member_id: memberId })
    await backend.rpc('update_team_member', {
      p_team_id: id,
      p_member_id: memberId,
      p_position: 'Analyst',
    })

    await openTeam(page, id, `${SCOPE} clearable ${RUN}`)
    await expect(page.getByText('Analyst · Starting')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /^Edit .+ roster details$/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Position').fill('')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    await expect(page.getByText('Starting', { exact: true })).toBeVisible({ timeout: 15_000 })
    const { data: row } = await backend
      .from('team_members')
      .select('roster_position')
      .eq('team_id', id)
      .eq('member_id', memberId)
    expect(row?.[0]?.roster_position).toBeNull()
  })
})

test.describe('moving somebody to another side', () => {
  test('takes them off one roster and puts them on another, keeping what they do', async ({
    page,
  }) => {
    const from = await makeTeam('source')
    const to = await makeTeam('target')
    const { data: members } = await backend
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
    const memberId = members?.[0]?.id as string

    await backend.rpc('add_team_member', { p_team_id: from, p_member_id: memberId })
    await backend.rpc('update_team_member', {
      p_team_id: from,
      p_member_id: memberId,
      p_position: 'IGL',
      p_status: 'substitute',
    })

    await openTeam(page, from, `${SCOPE} source ${RUN}`)
    await expect(page.getByText('IGL · Substitute')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /^Move .+ to another team$/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /^Move / })).toBeVisible()
    // Nowhere chosen yet, so there is nothing to do.
    await expect(dialog.getByRole('button', { name: 'Move', exact: true })).toBeDisabled()

    await dialog.getByLabel('Move to').click()
    await page.getByRole('option', { name: `${SCOPE} target ${RUN}` }).click()
    await dialog.getByRole('button', { name: 'Move', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    // Off this one.
    await expect(page.getByText('Nobody is on this team yet.')).toBeVisible({ timeout: 15_000 })
    expect(await rosterOf(from)).toHaveLength(0)

    // And onto the other, with what they do intact.
    expect(await rosterOf(to)).toEqual([memberId])
    await openTeam(page, to, `${SCOPE} target ${RUN}`)
    await expect(page.getByText('IGL · Substitute')).toBeVisible({ timeout: 15_000 })

    // One entry, on the team they left, naming where they went.
    const { data: record } = await backend
      .from('audit_logs')
      .select('action, entity_id')
      .eq('entity_id', from)
      .eq('action', 'team.member_moved')
    expect(record ?? []).toHaveLength(1)
  })

  test('offers no move when the organization has nowhere else active', async ({ page }) => {
    // Every other team of this run is archived by the sweep, so the only
    // destinations are other runs' teams; this asserts the control is absent
    // when the dialog would have nothing to offer.
    const id = await makeTeam('lonely')
    const { data: members } = await backend
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
    await backend.rpc('add_team_member', {
      p_team_id: id,
      p_member_id: members?.[0]?.id as string,
    })

    const { data: active } = await backend
      .from('teams')
      .select('id')
      .is('archived_at', null)
      .neq('id', id)

    await openTeam(page, id, `${SCOPE} lonely ${RUN}`)
    await expect(page.getByRole('button', { name: /^Edit .+ roster details$/ })).toBeVisible({
      timeout: 15_000,
    })

    const move = page.getByRole('button', { name: /^Move .+ to another team$/ })
    if ((active ?? []).length === 0) await expect(move).toHaveCount(0)
    else await expect(move).toBeVisible()
  })
})
