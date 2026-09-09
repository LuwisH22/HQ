import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * A project from planned to deleted, through the interface.
 *
 * The stage is server-authoritative, so most of what matters is what is *not*
 * offered: there is no dropdown that could mark a planned project finished,
 * and no "Mark as done" while a review deadline is still ahead. Those absences
 * are asserted as carefully as the actions are.
 *
 * One thing cannot be driven from here: a review deadline actually passing.
 * The shortest period the product offers is an hour, and no client may write
 * `review_deadline_at` — which is the point of it. So this drives the
 * no-limit path end to end, checks that a timed review hides completion and
 * shows the countdown, and leaves "refused before the deadline" to
 * `scripts/verify-project-lifecycle.mjs`, which asks the routine directly.
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
  'Set E2E_EMAIL / E2E_PASSWORD and the Supabase env to run the lifecycle specs.',
)

test.use({ storageState: '.auth/owner.json' })
test.describe.configure({ mode: 'serial' })

let SCOPE = 'E2E lifecycle'
let RUN = '0000'

let backend: SupabaseClient
let organizationId: string

test.beforeAll(async () => {
  SCOPE = `E2E lifecycle ${test.info().project.name}`
  RUN = Date.now().toString(36).slice(-4)

  backend = createClient(URL as string, KEY as string, { auth: { persistSession: false } })
  const { error } = await backend.auth.signInWithPassword({
    email: EMAIL as string,
    password: PASSWORD as string,
  })
  if (error) throw new Error(`lifecycle fixtures could not sign in: ${error.message}`)

  const { data: orgs } = await backend.from('organizations').select('id')
  organizationId = (orgs ?? [])[0]?.id as string
  if (!organizationId) throw new Error('lifecycle fixtures found no organization')
  await sweep()
})

async function sweep(): Promise<void> {
  const { data } = await backend.from('projects').select('id').like('name', `${SCOPE}%`)
  for (const row of data ?? []) {
    await backend.rpc('delete_project', { p_project_id: row.id })
  }
}

test.afterAll(async () => {
  if (!backend) return
  await sweep()
  await backend.auth.signOut({ scope: 'local' })
})

async function start(what: string, status = 'planned'): Promise<string> {
  const { data, error } = await backend.rpc('create_project', {
    p_organization_id: organizationId,
    p_name: `${SCOPE} ${what} ${RUN}`,
    p_status: status,
  })
  if (error) throw new Error(`could not create ${what}: ${error.message}`)
  return data as string
}

async function open(page: Page, projectId: string): Promise<void> {
  await page.goto(`/#/projects/${projectId}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
}

const stageOf = async (projectId: string) => {
  const { data } = await backend
    .from('projects')
    .select('status, archived_at, review_round, review_deadline_at')
    .eq('id', projectId)
  return data?.[0]
}

test.describe('the workflow', () => {
  test('walks a project from planned to done, and back once on the way', async ({ page }) => {
    const id = await start('walk')
    await open(page, id)

    // --- planned ------------------------------------------------------
    await expect(page.getByText('Stage 1 of 4: Planned')).toBeAttached()
    // No dropdown, and nothing that could skip a stage.
    await expect(page.getByRole('button', { name: 'Mark as done' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Send to review' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Start project' }).click()
    await expect(page.getByText('Stage 2 of 4: In progress')).toBeAttached({ timeout: 15_000 })
    expect((await stageOf(id))?.status).toBe('in_progress')

    // --- in progress → review ------------------------------------------
    await expect(page.getByRole('button', { name: 'Mark as done' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Send to review' }).click()

    const sending = page.getByRole('dialog')
    await expect(sending.getByRole('heading', { name: 'Send to review?' })).toBeVisible()
    await sending.getByLabel('Review period').click()
    await page.getByRole('option', { name: 'No limit' }).click()
    await sending.getByRole('button', { name: 'Send to review' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    await expect(page.getByText('Stage 3 of 4: In review')).toBeAttached({ timeout: 15_000 })
    const reviewing = await stageOf(id)
    expect(reviewing?.status).toBe('in_review')
    expect(reviewing?.review_round).toBe(1)
    expect(reviewing?.review_deadline_at).toBeNull()

    // --- something said in review --------------------------------------
    const saidFirst = `Colour grade is off ${RUN}`
    await page.getByLabel('Write a review comment').fill(saidFirst)
    await page.getByRole('button', { name: 'Send comment' }).click()
    await expect(page.getByText(saidFirst)).toBeVisible({ timeout: 15_000 })

    // --- changes requested ---------------------------------------------
    await page.getByRole('button', { name: 'Request changes' }).click()
    await expect(page.getByText('Stage 2 of 4: In progress')).toBeAttached({ timeout: 15_000 })
    // The history is not deleted when a round ends. That is the point of it.
    await expect(page.getByText(saidFirst)).toBeVisible()
    expect((await stageOf(id))?.review_round).toBe(1)

    // --- reviewed again -------------------------------------------------
    await page.getByRole('button', { name: 'Send to review' }).click()
    await page.getByRole('dialog').getByLabel('Review period').click()
    await page.getByRole('option', { name: 'No limit' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Send to review' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    expect((await stageOf(id))?.review_round).toBe(2)

    // A second round only reads as a second round once something is said in
    // it — until then there is one conversation, correctly shown as one.
    const saidAgain = `Better now ${RUN}`
    await page.getByLabel('Write a review comment').fill(saidAgain)
    await page.getByRole('button', { name: 'Send comment' }).click()
    await expect(page.getByText(saidAgain)).toBeVisible({ timeout: 15_000 })

    // Both rounds, both readable, in order.
    await expect(page.getByText('Round 1')).toBeVisible()
    await expect(page.getByText('Round 2')).toBeVisible()
    await expect(page.getByText(saidFirst)).toBeVisible()

    // --- done ------------------------------------------------------------
    await page.getByRole('button', { name: 'Mark as done' }).click()
    const completing = page.getByRole('dialog')
    await expect(completing.getByRole('heading', { name: 'Mark as done?' })).toBeVisible()
    await completing.getByRole('button', { name: 'Mark as done' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    await expect(page.getByText('Stage 4 of 4: Done')).toBeAttached({ timeout: 15_000 })
    expect((await stageOf(id))?.status).toBe('done')
    // Terminal: there is nothing further offered, and no way back.
    await expect(page.getByRole('button', { name: 'Send to review' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start project' })).toHaveCount(0)
  })

  test('will not offer completion while a review deadline is still ahead', async ({ page }) => {
    const id = await start('timed', 'in_progress')
    await open(page, id)

    await page.getByRole('button', { name: 'Send to review' }).click()
    await page.getByRole('dialog').getByLabel('Review period').click()
    await page.getByRole('option', { name: '24 hours' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Send to review' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    await expect(page.getByText('Stage 3 of 4: In review')).toBeAttached({ timeout: 15_000 })
    // The countdown reads from the server's instant, and the button that the
    // routine would refuse is simply not drawn.
    await expect(page.getByText(/Review ends in/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark as done' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Request changes' })).toBeVisible()

    const row = await stageOf(id)
    expect(row?.review_deadline_at).not.toBeNull()
  })

  test('warns about unfinished work before completing', async ({ page }) => {
    const id = await start('unfinished', 'in_progress')
    await backend.rpc('create_task', { p_project_id: id, p_title: `${SCOPE} still open ${RUN}` })
    await backend.rpc('transition_project', {
      p_project_id: id,
      p_target: 'in_review',
      p_review_duration_minutes: null,
    })

    await open(page, id)
    await page.getByRole('button', { name: 'Mark as done' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('1 task is not complete.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Complete anyway' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    expect((await stageOf(id))?.status).toBe('done')
    // The work is untouched: completing a project does not finish its tasks.
    const { data: tasks } = await backend.from('tasks').select('status').eq('project_id', id)
    expect(tasks?.[0]?.status).toBe('todo')
  })
})

test.describe('archiving, restoring and deleting', () => {
  test('archives without losing the stage, and restores to it', async ({ page }) => {
    const id = await start('archive', 'in_progress')
    await backend.rpc('transition_project', {
      p_project_id: id,
      p_target: 'in_review',
      p_review_duration_minutes: null,
    })

    await open(page, id)
    await page.getByRole('button', { name: 'Archive', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Archive project?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Archive project' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })

    // Put away, and still exactly where it had got to. Before 6.5 archiving
    // overwrote that, and the answer was gone for good.
    const archived = await stageOf(id)
    expect(archived?.archived_at).not.toBeNull()
    expect(archived?.status).toBe('in_review')
    await expect(page.getByText('Stage 3 of 4: In review')).toBeAttached()

    // And nothing may move it along while it is away.
    await expect(page.getByRole('button', { name: 'Request changes' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByRole('button', { name: 'Request changes' })).toBeVisible({
      timeout: 15_000,
    })
    const back = await stageOf(id)
    expect(back?.archived_at).toBeNull()
    expect(back?.status).toBe('in_review')
  })

  test('deletes a project and everything on it, after asking', async ({ page }) => {
    const id = await start('delete', 'in_progress')
    const { data: task } = await backend.rpc('create_task', {
      p_project_id: id,
      p_title: `${SCOPE} doomed ${RUN}`,
    })
    await backend.rpc('create_task_comment', { p_task_id: task, p_body: 'Something about it' })

    await open(page, id)
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /^Delete/ })).toBeVisible()
    // It says what goes, and that it cannot be undone.
    await expect(dialog.getByText(/cannot be undone/i)).toBeVisible()
    // And it offers the reversible thing instead.
    await expect(dialog.getByText(/archive it instead/i)).toBeVisible()

    // Backing out leaves everything alone.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await stageOf(id)).toBeTruthy()

    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete project' }).click()

    // It goes back to the list, because there is nothing to come back to.
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible({
      timeout: 20_000,
    })
    expect(await stageOf(id)).toBeUndefined()

    const { data: tasks } = await backend.from('tasks').select('id').eq('project_id', id)
    expect(tasks ?? []).toHaveLength(0)
    const { data: comments } = await backend.from('task_comments').select('id').eq('task_id', task)
    expect(comments ?? []).toHaveLength(0)

    // The record outlives the row.
    const { data: record } = await backend
      .from('audit_logs')
      .select('action')
      .eq('entity_id', id)
      .eq('action', 'project.deleted')
    expect(record ?? []).toHaveLength(1)
  })
})

test.describe('the list', () => {
  test('says where each project is and who is carrying it', async ({ page }) => {
    const id = await start('listed', 'in_progress')
    const { data: task } = await backend.rpc('create_task', {
      p_project_id: id,
      p_title: `${SCOPE} assigned ${RUN}`,
    })
    const { data: members } = await backend
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
    await backend.rpc('assign_task', {
      p_task_id: task,
      p_assignee_id: members?.[0]?.id as string,
    })

    await page.goto('/#/projects')
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible({
      timeout: 20_000,
    })

    const row = page.getByRole('link', { name: new RegExp(`${SCOPE} listed ${RUN}`) })
    await expect(row).toBeVisible({ timeout: 20_000 })
    // The stage, said in words rather than only in dots.
    await expect(row.getByText('Stage 2 of 4: In progress')).toBeAttached()
    // And who is actually on it, rather than only how many people it is for.
    await expect(row.getByText(/Working on it:/)).toBeAttached({ timeout: 20_000 })
    await expect(row.getByText(/1 task/)).toBeVisible()

    // Finishing the work takes them off the list without touching the roster.
    await backend.rpc('move_task', { p_task_id: task, p_status: 'done' })
    await expect(row.getByText('No active assignees')).toBeVisible({ timeout: 20_000 })
    await expect(row.getByText(/1 done/)).toBeVisible()
  })
})

/**
 * The workflow has to fit on a phone.
 *
 * A lifecycle track, a countdown, a review conversation and a destructive
 * confirmation all arrived on a page that was already a header and a board, so
 * the thing to check is that none of it pushes the page sideways and that the
 * action which moves the project along is still reachable.
 */
for (const width of [390, 412]) {
  test.describe(`${String(width)}px`, () => {
    test(`keeps the workflow usable at ${String(width)}px`, async ({ page }) => {
      const id = await start(`narrow ${String(width)}`, 'in_progress')
      await backend.rpc('transition_project', {
        p_project_id: id,
        p_target: 'in_review',
        p_review_duration_minutes: 1440,
      })

      await page.setViewportSize({ width, height: 844 })
      await open(page, id)

      const overflows = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        )

      await expect(page.getByText('Stage 3 of 4: In review')).toBeAttached()
      await expect(page.getByText(/Review ends in/)).toBeVisible()
      expect(await overflows()).toBe(false)

      // The action that moves it along is reachable, not merely present.
      const changes = page.getByRole('button', { name: 'Request changes' })
      await changes.scrollIntoViewIfNeeded()
      await expect(changes).toBeVisible()

      // The review conversation is usable at this width.
      const said = `From a phone ${RUN}`
      const composer = page.getByLabel('Write a review comment')
      await composer.scrollIntoViewIfNeeded()
      await composer.fill(said)
      await page.getByRole('button', { name: 'Send comment' }).click()
      await expect(page.getByText(said)).toBeVisible({ timeout: 15_000 })
      expect(await overflows()).toBe(false)

      // And so is the confirmation that cannot be undone.
      await page.getByRole('button', { name: 'Delete', exact: true }).scrollIntoViewIfNeeded()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('button', { name: 'Delete project' })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
      expect(await overflows()).toBe(false)
      await dialog.getByRole('button', { name: 'Cancel' }).click()

      // The list carries the same information at the same width.
      await page.goto('/#/projects')
      await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible({
        timeout: 20_000,
      })
      const row = page.getByRole('link', { name: new RegExp(`narrow ${String(width)} ${RUN}`) })
      await expect(row).toBeVisible()
      await expect(row.getByText('Stage 3 of 4: In review')).toBeAttached()
      expect(await overflows()).toBe(false)
    })
  })
}

test.describe('a page nobody is touching', () => {
  test('follows a review started, commented on and ended somewhere else', async ({ page }) => {
    const id = await start('watched', 'in_progress')
    await open(page, id)
    await expect(page.getByText('Stage 2 of 4: In progress')).toBeAttached()

    // --- sent to review from another client -----------------------------
    await backend.rpc('transition_project', {
      p_project_id: id,
      p_target: 'in_review',
      p_review_duration_minutes: 1440,
    })

    // No navigation, no reload, no click.
    await expect(page.getByText('Stage 3 of 4: In review')).toBeAttached({ timeout: 20_000 })
    // The deadline arrives with it, so the countdown is right without asking.
    await expect(page.getByText(/Review ends in/)).toBeVisible({ timeout: 20_000 })

    // --- somebody else's review comment ---------------------------------
    const said = `Said from another socket ${RUN}`
    await backend.rpc('create_project_review_comment', { p_project_id: id, p_body: said })
    await expect(page.getByText(said)).toBeVisible({ timeout: 20_000 })

    // --- and its retraction ----------------------------------------------
    const { data: comments } = await backend
      .from('project_review_comments')
      .select('id')
      .eq('project_id', id)
    await backend.rpc('delete_project_review_comment', {
      p_comment_id: comments?.[0]?.id as string,
    })
    await expect(page.getByText('This comment was deleted.')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(said)).toHaveCount(0)

    // --- changes requested elsewhere --------------------------------------
    await backend.rpc('transition_project', { p_project_id: id, p_target: 'in_progress' })
    await expect(page.getByText('Stage 2 of 4: In progress')).toBeAttached({ timeout: 20_000 })
    // The countdown goes with the deadline it was counting.
    await expect(page.getByText(/Review ends in/)).toHaveCount(0)
  })

  test('follows an assignment changing who is shown as working on it', async ({ page }) => {
    const id = await start('watched list', 'in_progress')
    const { data: task } = await backend.rpc('create_task', {
      p_project_id: id,
      p_title: `${SCOPE} watched work ${RUN}`,
    })

    await page.goto('/#/projects')
    const row = page.getByRole('link', { name: new RegExp(`watched list ${RUN}`) })
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row.getByText('No active assignees')).toBeVisible({ timeout: 20_000 })

    const { data: members } = await backend
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
    await backend.rpc('assign_task', {
      p_task_id: task,
      p_assignee_id: members?.[0]?.id as string,
    })

    // The list hears about tasks for exactly this reason: who is carrying the
    // work is derived from assignment, so an assignment made anywhere is what
    // makes this row wrong.
    await expect(row.getByText(/Working on it:/)).toBeAttached({ timeout: 20_000 })
  })
})
