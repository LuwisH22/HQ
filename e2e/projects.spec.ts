import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Projects, against real rows.
 *
 * The fixtures are made through the same guarded routine the form calls, from
 * a second client signed in as the same account — so they are rows, subject to
 * the same RLS the page reads through.
 *
 * Nothing here deletes a project, because nothing in the product does: the
 * suite archives what it made, and the names carry the Playwright project so
 * desktop and mobile never read each other's.
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
  'Set E2E_EMAIL / E2E_PASSWORD and the Supabase env to run the project specs.',
)

test.use({ storageState: '.auth/owner.json' })

/** One worker for the whole file: the fixtures are rows in a shared database. */
test.describe.configure({ mode: 'serial' })

/**
 * Names carry the project that made them, as the calendar suite's do. Desktop
 * and mobile run this file at the same time against one organization, and a
 * shared name would have each reading the other's rows.
 */
let SCOPE = 'E2E project'

/**
 * A tag for this run, because nothing deletes a project.
 *
 * The suite archives what it made, and an archived project is still on the
 * list — so a fixed name would have the second run finding two of everything.
 * Four characters of the clock is enough to tell one run's rows from the next.
 */
let RUN = ''

let backend: SupabaseClient
let organizationId: string

test.beforeAll(async () => {
  SCOPE = `E2E project ${test.info().project.name}`
  RUN = Date.now().toString(36).slice(-4)

  backend = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error } = await backend.auth.signInWithPassword({
    email: EMAIL as string,
    password: PASSWORD as string,
  })
  if (error) throw new Error(`project fixtures could not sign in: ${error.message}`)

  const { data: orgs } = await backend.from('organizations').select('id')
  organizationId = (orgs ?? [])[0]?.id as string
  if (!organizationId) throw new Error('project fixtures found no organization')

  await sweep()
})

/**
 * Put away everything this project made.
 *
 * Archiving rather than deleting, because that is all the product can do — the
 * table has no delete path on purpose. Archived rows stay out of the way of
 * the next run, which reads its own names anyway.
 */
async function sweep(): Promise<void> {
  const { data } = await backend
    .from('projects')
    .select('id, status')
    .like('name', `${SCOPE}%`)
    .neq('status', 'archived')
  for (const row of data ?? []) {
    await backend.rpc('archive_project', { p_project_id: row.id })
  }
}

test.afterEach(async () => {
  if (backend) await sweep()
})

test.afterAll(async () => {
  if (!backend) return
  await sweep()
  // Local scope: the default revokes every token this account holds, which
  // would sign the other project out mid-run.
  await backend.auth.signOut({ scope: 'local' })
})

/** A project of this run's own, made the way the form makes one. */
async function start(
  what: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; name: string }> {
  const name = `${SCOPE} ${what} ${RUN}`
  const { data, error } = await backend.rpc('create_project', {
    p_organization_id: organizationId,
    p_name: name,
    p_status: 'active',
    ...extra,
  })
  if (error) throw new Error(`could not start ${name}: ${error.message}`)
  return { id: data as string, name }
}

/** What the database holds for one project. */
async function rowOf(id: string) {
  const { data } = await backend
    .from('projects')
    .select('name, description, status, start_date, due_date')
    .eq('id', id)
  return (data ?? [])[0] as
    | {
        name: string
        description: string | null
        status: string
        start_date: string | null
        due_date: string | null
      }
    | undefined
}

async function goToProjects(page: Page): Promise<void> {
  await page.goto('/#/projects')
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible({
    timeout: 20_000,
  })
}

const projectNamed = (page: Page, name: string) =>
  page.getByRole('link', { name: new RegExp(name) })

test.describe('the list', () => {
  test('groups what the organization is working on', async ({ page }) => {
    const active = await start('running')
    const planned = await start('to come', { p_status: 'planned' })

    await goToProjects(page)

    await expect(projectNamed(page, active.name)).toBeVisible({ timeout: 15_000 })
    await expect(projectNamed(page, planned.name)).toBeVisible()

    // Grouped by status, and only the groups with something in them.
    await expect(page.getByRole('heading', { name: 'Active', level: 2 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Planned', level: 2 })).toBeVisible()

    // A row says the things a list of projects is asked for.
    await expect(projectNamed(page, active.name)).toHaveAccessibleName(new RegExp(active.name))
  })

  test('says so, calmly, when there is nothing to show', async ({ page }) => {
    // Everything this project made is archived by the sweep, and an archived
    // group is still a group — so this asserts the empty state's own copy
    // only when the organization genuinely has nothing.
    await goToProjects(page)
    const { data } = await backend
      .from('projects')
      .select('id')
      .eq('organization_id', organizationId)
    if ((data ?? []).length === 0) {
      await expect(page.getByText('No projects yet')).toBeVisible()
    } else {
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
    }
  })

  test('is offered to somebody who may start one', async ({ page }) => {
    await goToProjects(page)
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible()
  })
})

test.describe('starting one', () => {
  test('creates a project and lands on it', async ({ page }) => {
    const name = `${SCOPE} made here ${RUN}`
    await goToProjects(page)
    await page.getByRole('button', { name: 'New project' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'New project' })).toBeVisible()
    await expect(dialog.getByLabel('Name')).toBeFocused()

    await dialog.getByLabel('Name').fill(`  ${name}  `)
    await dialog.getByLabel('Description').fill('Two weeks, one bootcamp.')
    await dialog.getByLabel('Starts').fill('2026-10-01')
    await dialog.getByLabel('Due').fill('2026-11-30')
    await dialog.getByRole('button', { name: 'Create project' }).click()

    // Straight into the thing that was just made.
    await expect(page).toHaveURL(/#\/projects\/[0-9a-f-]{36}$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()

    const { data } = await backend.from('projects').select('id, name, status').eq('name', name)
    expect(data).toHaveLength(1)
    // Trimmed, not stored with the spaces it was typed with.
    expect(data?.[0]?.name).toBe(name)
    expect(data?.[0]?.status).toBe('planned')
  })

  test('will not create one with no name', async ({ page }) => {
    await goToProjects(page)
    await page.getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Create project' }).click()

    await expect(page.getByText('A name is required')).toBeVisible()
    await expect(dialog).toBeVisible()
  })

  test('will not create one due before it starts', async ({ page }) => {
    await goToProjects(page)
    await page.getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog')

    await dialog.getByLabel('Name').fill(`${SCOPE} backwards ${RUN}`)
    await dialog.getByLabel('Starts').fill('2026-11-30')
    await dialog.getByLabel('Due').fill('2026-10-01')
    await dialog.getByRole('button', { name: 'Create project' }).click()

    await expect(page.getByText('A project cannot be due before it starts')).toBeVisible()
    await expect(dialog).toBeVisible()
  })

  test('closes without creating anything when cancelled', async ({ page }) => {
    await goToProjects(page)
    await page.getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name').fill(`${SCOPE} cancelled ${RUN}`)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    const { data } = await backend
      .from('projects')
      .select('id')
      .eq('name', `${SCOPE} cancelled ${RUN}`)
    expect(data ?? []).toHaveLength(0)
  })
})

test.describe('changing one', () => {
  test('edits a project, and the detail catches up', async ({ page }) => {
    const project = await start('editable', {
      p_description: 'As it was.',
      p_start_date: '2026-10-01',
      p_due_date: '2026-11-30',
    })
    const renamed = `${project.name} again`

    await page.goto(`/#/projects/${project.id}`)
    await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible({
      timeout: 20_000,
    })

    await page.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog')
    // The form opens on what the project actually is.
    await expect(dialog.getByLabel('Name')).toHaveValue(project.name)
    await expect(dialog.getByLabel('Starts')).toHaveValue('2026-10-01')
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    await dialog.getByLabel('Name').fill(renamed)
    await dialog.getByLabel('Due').fill('2026-12-31')
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: renamed, level: 1 })).toBeVisible()

    const row = await rowOf(project.id)
    expect(row?.name).toBe(renamed)
    expect(row?.due_date).toBe('2026-12-31')
    // What was not touched is left alone.
    expect(row?.description).toBe('As it was.')
  })

  test('will not save one due before it starts', async ({ page }) => {
    const project = await start('unsaveable', { p_start_date: '2026-10-01' })

    await page.goto(`/#/projects/${project.id}`)
    await page.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Due').fill('2026-09-01')
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByText('A project cannot be due before it starts')).toBeVisible()
    await expect(dialog).toBeVisible()
    expect((await rowOf(project.id))?.due_date).toBeNull()
  })
})

test.describe('archiving one', () => {
  test('asks first, then moves it out of the way', async ({ page }) => {
    const project = await start('archivable')

    await page.goto(`/#/projects/${project.id}`)
    await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible({
      timeout: 20_000,
    })
    await page.getByRole('button', { name: 'Archive' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Archive project?' })).toBeVisible()
    await expect(dialog.getByText(project.name)).toBeVisible()

    await dialog.getByRole('button', { name: 'Archive project' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    // Archived, not deleted: the row and everything on it stay.
    const row = await rowOf(project.id)
    expect(row?.status).toBe('archived')
    expect(row?.name).toBe(project.name)

    // And it reads as archived in the list rather than disappearing from it.
    await goToProjects(page)
    await expect(page.getByRole('heading', { name: 'Archived', level: 2 })).toBeVisible()
    await expect(projectNamed(page, project.name)).toBeVisible()
  })

  test('leaves it alone when the question is declined', async ({ page }) => {
    const project = await start('kept')

    await page.goto(`/#/projects/${project.id}`)
    await page.getByRole('button', { name: 'Archive' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await rowOf(project.id))?.status).toBe('active')
  })
})

test.describe('one project', () => {
  test('shows what it is, and that there is no work on it yet', async ({ page }) => {
    const project = await start('detailed', {
      p_description: 'Two weeks in Jakarta.',
      p_start_date: '2026-10-01',
      p_due_date: '2026-11-30',
    })

    await page.goto(`/#/projects/${project.id}`)
    await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText('Two weeks in Jakarta.')).toBeVisible()
    await expect(page.getByText(/1 Oct 2026 – 30 Nov 2026/)).toBeVisible()

    // Whoever started it is on it, without anybody adding them.
    await expect(page.getByRole('heading', { name: 'Members', level: 2 })).toBeVisible()

    // And the board it will be worked on, empty and saying so plainly.
    await expect(page.getByRole('list', { name: 'Board' })).toBeVisible()
    for (const column of ['Backlog', 'Todo', 'In progress', 'Review', 'Done']) {
      await expect(page.getByRole('listitem', { name: column })).toBeVisible()
    }
    await expect(page.getByText(/coming soon|phase|soon/i)).toHaveCount(0)
  })

  test('says so when there is no such project', async ({ page }) => {
    await page.goto('/#/projects/00000000-0000-4000-8000-000000000000')
    await expect(page.getByText('No such project')).toBeVisible({ timeout: 20_000 })
  })

  test('adds somebody to a project, and takes them off again', async ({ page }) => {
    const project = await start('crewed')

    // Somebody other than the person running the test, if this organization
    // has one; without a second member there is nobody to add.
    const { data: members } = await backend
      .from('organization_members')
      .select('id, user_id, status')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
    const { data: auth } = await backend.auth.getUser()
    const other = (members ?? []).find((row) => row.user_id !== auth.user?.id)
    test.skip(!other, 'This organization has only one active member.')

    await page.goto(`/#/projects/${project.id}`)
    await expect(page.getByRole('heading', { name: 'Members', level: 2 })).toBeVisible({
      timeout: 20_000,
    })

    const before = await rosterOf(project.id)
    await page.getByRole('button', { name: 'Add' }).click()
    await page.getByRole('menuitem').first().click()

    await expect
      .poll(async () => (await rosterOf(project.id)).length, { timeout: 15_000 })
      .toBe(before.length + 1)

    // And off again, by the button beside their name.
    const removable = page.getByRole('button', { name: /^Remove / }).last()
    await removable.click()
    await expect
      .poll(async () => (await rosterOf(project.id)).length, { timeout: 15_000 })
      .toBe(before.length)
  })
})

/** Who is on a project, straight from the database. */
async function rosterOf(projectId: string): Promise<{ member_id: string }[]> {
  const { data } = await backend
    .from('project_members')
    .select('member_id')
    .eq('project_id', projectId)
  return data ?? []
}

test.describe('narrow screens', () => {
  for (const width of [390, 412]) {
    test(`fits ${String(width)}px without a page-level overflow`, async ({ page }) => {
      const project = await start(`narrow ${String(width)}`, { p_due_date: '2026-11-30' })
      await page.setViewportSize({ width, height: 844 })

      const overflowing = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        )

      await goToProjects(page)
      await expect(projectNamed(page, project.name)).toBeVisible({ timeout: 15_000 })
      expect(await overflowing(), `the list at ${String(width)}px`).toBe(false)

      await projectNamed(page, project.name).click()
      await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible()
      expect(await overflowing(), `one project at ${String(width)}px`).toBe(false)

      await page.getByRole('button', { name: 'Edit' }).click()
      await expect(page.getByRole('dialog').getByLabel('Name')).toBeVisible()
      expect(await overflowing(), `the form at ${String(width)}px`).toBe(false)
    })
  }
})
