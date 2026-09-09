import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Labels and comments, against real rows.
 *
 * Fixtures are made through the same guarded routines the UI calls, from a
 * second client signed in as the same account, and what is asserted after a
 * click is the row in the database — including the one thing no screen can
 * show: that a deleted comment's words are gone.
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
  'Set E2E_EMAIL / E2E_PASSWORD and the Supabase env to run the task specs.',
)

test.use({ storageState: '.auth/owner.json' })
test.describe.configure({ mode: 'serial' })

let SCOPE = 'E2E labels'
let RUN = ''
let backend: SupabaseClient
let organizationId: string
/** One project for the whole file, made fresh and archived at the end. */
let projectId = ''

test.beforeAll(async () => {
  SCOPE = `E2E labels ${test.info().project.name}`
  RUN = Date.now().toString(36).slice(-4)

  backend = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error } = await backend.auth.signInWithPassword({
    email: EMAIL as string,
    password: PASSWORD as string,
  })
  if (error) throw new Error(`task fixtures could not sign in: ${error.message}`)

  const { data: orgs } = await backend.from('organizations').select('id')
  organizationId = (orgs ?? [])[0]?.id as string

  const { data, error: projectError } = await backend.rpc('create_project', {
    p_organization_id: organizationId,
    p_name: `${SCOPE} board ${RUN}`,
    p_status: 'in_progress',
  })
  if (projectError) throw new Error(`task fixtures failed: ${projectError.message}`)
  projectId = data as string
})

test.afterAll(async () => {
  if (!backend) return
  const { data } = await backend.from('tasks').select('id').eq('project_id', projectId)
  for (const row of data ?? []) await backend.rpc('delete_task', { p_task_id: row.id })
  await backend.rpc('delete_project', { p_project_id: projectId })
  await backend.auth.signOut({ scope: 'local' })
})

/** Everything this file made, cleared between tests. */
test.afterEach(async () => {
  if (!backend) return
  const { data } = await backend.from('tasks').select('id').eq('project_id', projectId)
  for (const row of data ?? []) await backend.rpc('delete_task', { p_task_id: row.id })
})

async function addTask(title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await backend.rpc('create_task', {
    p_project_id: projectId,
    p_title: `${SCOPE} ${title}`,
    ...extra,
  })
  if (error) throw new Error(`could not add ${title}: ${error.message}`)
  return data as string
}

async function openBoard(page: Page): Promise<void> {
  await page.goto(`/#/projects/${projectId}`)
  await expect(page.getByRole('list', { name: 'Board' })).toBeVisible({ timeout: 20_000 })
}

const cardNamed = (page: Page, title: string) =>
  page.locator('[data-task-id]').filter({ hasText: title })

/** What the database holds for one task's labels and comments. */
async function labelsOn(taskId: string): Promise<string[]> {
  const { data } = await backend.from('task_labels').select('label_id').eq('task_id', taskId)
  return (data ?? []).map((row) => row.label_id as string)
}

async function commentsOn(taskId: string) {
  const { data } = await backend
    .from('task_comments')
    .select('id, body, deleted_at, created_at')
    .eq('task_id', taskId)
    .order('created_at')
  return data ?? []
}

async function openTask(page: Page, title: string) {
  await openBoard(page)
  await cardNamed(page, title).getByRole('button').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
  return dialog
}

test.describe('labels', () => {
  test('are made, renamed and removed from one compact list', async ({ page }) => {
    const name = `${SCOPE} scrim ${RUN}`
    await openBoard(page)

    await page.getByRole('button', { name: 'Labels' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Labels' })).toBeVisible()

    await dialog.getByLabel('New label').fill(name)
    await dialog.getByRole('button', { name: 'Add' }).click()

    await expect(dialog.getByLabel(`Rename ${name}`)).toBeVisible({ timeout: 15_000 })
    const { data: made } = await backend
      .from('project_labels')
      .select('id, name, color')
      .eq('project_id', projectId)
      .eq('name', name)
    expect(made).toHaveLength(1)
    expect(made?.[0]?.color).toBe('neutral')

    // The same name again is refused, and says so rather than making a second.
    await dialog.getByLabel('New label').fill(name.toUpperCase())
    await dialog.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('alert')).toContainText(/already has a label/i)

    // Renaming happens on blur, which is where a one-field row wants it.
    await dialog.getByLabel(`Rename ${name}`).fill(`${name} renamed`)
    await dialog.getByLabel(`Rename ${name}`).blur()
    await expect
      .poll(
        async () => {
          const { data } = await backend
            .from('project_labels')
            .select('name')
            .eq('id', made?.[0]?.id as string)
          return data?.[0]?.name
        },
        { timeout: 15_000 },
      )
      .toBe(`${name} renamed`)

    await dialog.getByRole('button', { name: `Delete ${name} renamed` }).click()
    await expect
      .poll(
        async () => {
          const { data } = await backend
            .from('project_labels')
            .select('id')
            .eq('id', made?.[0]?.id as string)
          return (data ?? []).length
        },
        { timeout: 15_000 },
      )
      .toBe(0)
  })

  test('go on a task and come off again', async ({ page }) => {
    const title = `${SCOPE} labelled ${RUN}`
    const taskId = await addTask(`labelled ${RUN}`)
    const { data: labelId } = await backend.rpc('create_label', {
      p_project_id: projectId,
      p_name: `${SCOPE} urgent ${RUN}`,
      p_color: 'danger',
    })

    const dialog = await openTask(page, title)
    await dialog.getByRole('button', { name: 'Label' }).click()
    await page.getByRole('menuitem', { name: new RegExp(`${SCOPE} urgent`) }).click()
    await page.keyboard.press('Escape')

    await expect.poll(async () => labelsOn(taskId), { timeout: 15_000 }).toEqual([labelId])

    // The chip is on the task, and the card behind it says so too.
    await expect(dialog.getByText(`${SCOPE} urgent ${RUN}`).first()).toBeVisible()
    await dialog.getByRole('button', { name: `Remove ${SCOPE} urgent ${RUN}` }).click()
    await expect.poll(async () => labelsOn(taskId), { timeout: 15_000 }).toEqual([])
  })

  test('made from the picker land on the task that needed them', async ({ page }) => {
    const title = `${SCOPE} inventing ${RUN}`
    const taskId = await addTask(`inventing ${RUN}`)

    // Five, so the picker offers its search box: below that it is a short
    // list and searching a short list is worse than reading it.
    for (const word of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
      await backend.rpc('create_label', {
        p_project_id: projectId,
        p_name: `${SCOPE} ${word} ${RUN}`,
      })
    }

    const dialog = await openTask(page, title)
    await dialog.getByRole('button', { name: 'Label' }).click()
    await expect(page.getByLabel('Find a label')).toBeVisible({ timeout: 15_000 })

    const fresh = `${SCOPE} fresh ${RUN}`
    await page.getByLabel('Find a label').fill(fresh)
    await page.getByRole('menuitem', { name: /^Create/ }).click()

    // Made because this task needed it, so it goes straight on.
    await expect.poll(async () => (await labelsOn(taskId)).length, { timeout: 15_000 }).toBe(1)
    const { data: made } = await backend
      .from('project_labels')
      .select('name')
      .eq('project_id', projectId)
      .eq('name', fresh)
    expect(made).toHaveLength(1)
  })
})

test.describe('comments', () => {
  test('are written, edited and taken back', async ({ page }) => {
    const title = `${SCOPE} discussed ${RUN}`
    const taskId = await addTask(`discussed ${RUN}`)

    const dialog = await openTask(page, title)
    await expect(dialog.getByText('Nothing said yet.')).toBeVisible()

    await dialog.getByLabel('Write a comment').fill('Booked for Thursday.')
    await dialog.getByRole('button', { name: 'Send comment' }).click()

    await expect(dialog.getByText('Booked for Thursday.')).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await commentsOn(taskId)).length, { timeout: 15_000 }).toBe(1)

    // A second one, and they read oldest first.
    await dialog.getByLabel('Write a comment').fill('Room 2, not room 1.')
    await dialog.getByRole('button', { name: 'Send comment' }).click()
    await expect(dialog.getByText('Room 2, not room 1.')).toBeVisible({ timeout: 15_000 })

    const both = await commentsOn(taskId)
    expect(both.map((one) => one.body)).toEqual(['Booked for Thursday.', 'Room 2, not room 1.'])

    // Editing your own.
    await dialog
      .getByRole('button', { name: /Actions for .* comment/ })
      .first()
      .click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await dialog.getByLabel('Edit comment').fill('Booked for Friday.')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()

    await expect
      .poll(async () => (await commentsOn(taskId))[0]?.body, { timeout: 15_000 })
      .toBe('Booked for Friday.')
    await expect(dialog.getByText(/edited/)).toBeVisible()
  })

  test('leave a neutral trace when deleted, and their words do not come back', async ({ page }) => {
    const title = `${SCOPE} regretted ${RUN}`
    const taskId = await addTask(`regretted ${RUN}`)
    const { error } = await backend.rpc('create_task_comment', {
      p_task_id: taskId,
      p_body: 'Something I should not have said.',
    })
    expect(error).toBeNull()

    const dialog = await openTask(page, title)
    await expect(dialog.getByText('Something I should not have said.')).toBeVisible({
      timeout: 15_000,
    })

    await dialog
      .getByRole('button', { name: /Actions for .* comment/ })
      .first()
      .click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()

    await expect(dialog.getByText('Comment deleted')).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText('Something I should not have said.')).toHaveCount(0)

    // The row stays; the words are somewhere no client may read.
    const rows = await commentsOn(taskId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.body).toBe('')
    expect(rows[0]?.deleted_at).not.toBeNull()

    const { error: peek } = await backend
      .from('task_comments')
      .select('deleted_body')
      .eq('task_id', taskId)
    expect(peek, 'the deleted body should not be selectable').not.toBeNull()
  })
})

test.describe('deleting a task', () => {
  test('takes its labels and its comments with it, and leaves the record', async ({ page }) => {
    const title = `${SCOPE} doomed ${RUN}`
    const taskId = await addTask(`doomed ${RUN}`)
    const { data: labelId } = await backend.rpc('create_label', {
      p_project_id: projectId,
      p_name: `${SCOPE} doomed label ${RUN}`,
    })
    await backend.rpc('assign_label', { p_task_id: taskId, p_label_id: labelId })
    await backend.rpc('create_task_comment', { p_task_id: taskId, p_body: 'Said once.' })

    const dialog = await openTask(page, title)
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    expect(await labelsOn(taskId)).toEqual([])
    expect(await commentsOn(taskId)).toEqual([])

    const { data: audit } = await backend
      .from('audit_logs')
      .select('action')
      .eq('entity_type', 'task')
      .eq('entity_id', taskId)
      .eq('action', 'task.deleted')
    expect(audit).toHaveLength(1)

    // And the label itself is untouched: it was a word about the work.
    const { data: label } = await backend
      .from('project_labels')
      .select('id')
      .eq('id', labelId as string)
    expect(label).toHaveLength(1)
  })
})

test.describe('narrow screens', () => {
  for (const width of [390, 412]) {
    test(`fits labels and comments at ${String(width)}px`, async ({ page }) => {
      const title = `${SCOPE} narrow ${String(width)} ${RUN}`
      const taskId = await addTask(`narrow ${String(width)} ${RUN}`)
      await page.setViewportSize({ width, height: 844 })

      const dialog = await openTask(page, title)
      await dialog.getByRole('button', { name: 'Label' }).scrollIntoViewIfNeeded()
      await expect(dialog.getByRole('button', { name: 'Label' })).toBeVisible()

      const composer = dialog.getByLabel('Write a comment')
      await composer.scrollIntoViewIfNeeded()
      await composer.fill('From a phone.')
      await dialog.getByRole('button', { name: 'Send comment' }).click()
      await expect.poll(async () => (await commentsOn(taskId)).length, { timeout: 15_000 }).toBe(1)

      const overflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflowing, `${String(width)}px`).toBe(false)
    })
  }
})
