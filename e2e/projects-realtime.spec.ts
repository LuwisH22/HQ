import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * A project keeping itself current.
 *
 * Every assertion waits for a real Supabase Realtime event to travel from a
 * second signed-in client — one calling the same routines the forms call — to
 * a page nobody has touched. Nothing here invokes an invalidation by hand: a
 * test that did would pass with the subscription deleted.
 *
 * The second client is the same account, because it is the only credential
 * this environment has. What delivery depends on is two sockets, not two
 * people; what it would take to prove the negative case — a member who may not
 * see this project — is a second identity with a narrower role, which is
 * stated rather than faked. `scripts/verify-projects-realtime.mjs` makes the
 * one negative case that is available here: an anonymous socket.
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
  'Set E2E_EMAIL / E2E_PASSWORD and the Supabase env to run the project realtime specs.',
)

test.use({ storageState: '.auth/owner.json' })

/** One worker: these tests write rows a watching page is waiting for. */
test.describe.configure({ mode: 'serial' })

/**
 * Names carry the project and the run.
 *
 * Desktop and mobile run this file at the same time against one database, and
 * nothing deletes a project — so a shared name would have each watching the
 * other's changes, and a second run finding the first run's leftovers.
 */
let SCOPE = 'E2E realtime'
let RUN = '0000'

let backend: SupabaseClient
let organizationId: string
let projectId: string

test.beforeAll(async () => {
  SCOPE = `E2E realtime ${test.info().project.name}`
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

  const { data, error: made } = await backend.rpc('create_project', {
    p_organization_id: organizationId,
    p_name: `${SCOPE} board ${RUN}`,
    p_status: 'in_progress',
  })
  if (made) throw new Error(`could not create the watched project: ${made.message}`)
  projectId = data as string
})

async function sweep(): Promise<void> {
  const { data: tasks } = await backend.from('tasks').select('id').eq('project_id', projectId)
  for (const row of tasks ?? []) await backend.rpc('delete_task', { p_task_id: row.id })

  // Deleted, since 6.5: nothing needs to be left lying around archived.
  const { data: projects } = await backend.from('projects').select('id').like('name', `${SCOPE}%`)
  for (const row of projects ?? []) {
    await backend.rpc('delete_project', { p_project_id: row.id })
  }
}

test.afterAll(async () => {
  if (!backend) return
  await sweep()
  // Local scope: the default revokes every token this account holds, which
  // would sign the other Playwright project out mid-run.
  await backend.auth.signOut({ scope: 'local' })
})

async function addTask(title: string): Promise<string> {
  const { data, error } = await backend.rpc('create_task', {
    p_project_id: projectId,
    p_title: `${SCOPE} ${title} ${RUN}`,
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

test.describe('a board nobody is touching', () => {
  test('shows a task somebody else added, moved and deleted', async ({ page }) => {
    await openBoard(page)

    const title = `${SCOPE} arrives ${RUN}`
    const taskId = await addTask('arrives')

    // No navigation, no reload, no click: the page was left alone.
    await expect(cardNamed(page, title)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('listitem', { name: 'Todo' })).toContainText(title)

    // --- moved --------------------------------------------------------
    const { error: moved } = await backend.rpc('move_task', {
      p_task_id: taskId,
      p_status: 'in_progress',
      p_before_id: null,
      p_after_id: null,
    })
    expect(moved).toBeNull()
    await expect(page.getByRole('listitem', { name: 'In progress' })).toContainText(title, {
      timeout: 20_000,
    })

    // --- deleted ------------------------------------------------------
    const { error: gone } = await backend.rpc('delete_task', { p_task_id: taskId })
    expect(gone).toBeNull()
    await expect(cardNamed(page, title)).toHaveCount(0, { timeout: 20_000 })
  })

  test('draws a label put on a card from somewhere else', async ({ page }) => {
    const taskId = await addTask('labelled')
    const title = `${SCOPE} labelled ${RUN}`
    await openBoard(page)
    await expect(cardNamed(page, title)).toBeVisible({ timeout: 20_000 })

    const { data: labelId, error: madeLabel } = await backend.rpc('create_label', {
      p_project_id: projectId,
      p_name: `${SCOPE.slice(-9)}-${RUN}`,
      p_color: 'brass',
    })
    if (madeLabel) throw new Error(`could not create a label: ${madeLabel.message}`)

    const { error: put } = await backend.rpc('assign_label', {
      p_task_id: taskId,
      p_label_id: labelId as string,
    })
    expect(put).toBeNull()

    // The chip is drawn from the catalogue by id, so this needs both the
    // `project_labels` insert and the `task_labels` insert to have landed.
    await expect(cardNamed(page, title)).toContainText(`${SCOPE.slice(-9)}-${RUN}`, {
      timeout: 20_000,
    })

    await backend.rpc('remove_label', { p_task_id: taskId, p_label_id: labelId as string })
    await expect(cardNamed(page, title)).not.toContainText(`${SCOPE.slice(-9)}-${RUN}`, {
      timeout: 20_000,
    })
    await backend.rpc('delete_label', { p_label_id: labelId as string })
    await backend.rpc('delete_task', { p_task_id: taskId })
  })
})

test.describe('a task somebody has open', () => {
  test('shows a comment written elsewhere, and its retraction', async ({ page }) => {
    const taskId = await addTask('talked about')
    const title = `${SCOPE} talked about ${RUN}`

    await openBoard(page)
    await cardNamed(page, title).getByRole('button').first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: title })).toBeVisible()

    const said = `Said from another socket ${RUN}`
    const { data: commentId, error } = await backend.rpc('create_task_comment', {
      p_task_id: taskId,
      p_body: said,
    })
    if (error) throw new Error(`could not comment: ${error.message}`)

    await expect(dialog).toContainText(said, { timeout: 20_000 })

    await backend.rpc('delete_task_comment', { p_comment_id: commentId as string })
    // Soft deletion: the row stays and says so, and the words are gone.
    await expect(dialog).toContainText(/deleted/i, { timeout: 20_000 })
    await expect(dialog).not.toContainText(said)

    await backend.rpc('delete_task', { p_task_id: taskId })
  })

  test('closes itself and says so when the task is deleted elsewhere', async ({ page }) => {
    const taskId = await addTask('doomed')
    const title = `${SCOPE} doomed ${RUN}`

    await openBoard(page)
    await cardNamed(page, title).getByRole('button').first().click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: title })).toBeVisible()

    await backend.rpc('delete_task', { p_task_id: taskId })

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 })
    // Vanishing without a word reads like the application lost your place.
    await expect(page.getByText('That task was deleted.')).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('the list of projects', () => {
  test('shows a project created and archived elsewhere', async ({ page }) => {
    await page.goto('/#/projects')
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible({
      timeout: 20_000,
    })

    const name = `${SCOPE} appears ${RUN}`
    const { data: id, error } = await backend.rpc('create_project', {
      p_organization_id: organizationId,
      p_name: name,
      p_status: 'in_progress',
    })
    if (error) throw new Error(`could not create a project: ${error.message}`)

    const row = page.getByRole('link', { name: new RegExp(name) })
    await expect(row).toBeVisible({ timeout: 20_000 })

    // Archiving is not deleting: the row moves to the archived group, and the
    // page has to hear about the update as well as the insert.
    await backend.rpc('archive_project', { p_project_id: id as string })
    await expect(page.getByRole('heading', { name: 'Archived' })).toBeVisible({ timeout: 20_000 })
  })
})

/**
 * The shapes a board has to keep while it is changing underneath somebody.
 *
 * A card arriving from another socket lengthens a column and can widen one,
 * which is exactly the moment a layout gives way. The board scrolls sideways
 * on purpose — five columns do not fit a phone — so what must not scroll is
 * the page around it.
 */
for (const width of [390, 412, 1280, 1440]) {
  test.describe(`${String(width)}px`, () => {
    test(`stays within ${String(width)}px while work arrives`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await openBoard(page)

      const title = `${SCOPE} ${String(width)} ${RUN}`
      const { data: taskId } = await backend.rpc('create_task', {
        p_project_id: projectId,
        p_title: title,
      })
      await expect(cardNamed(page, title)).toBeVisible({ timeout: 20_000 })

      const pageScrolls = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(pageScrolls).toBe(false)

      // The board is the one thing allowed to scroll sideways, and every
      // column has to be reachable when it does — a column that cannot be
      // scrolled to is a column that does not exist.
      const last = page.getByRole('listitem', { name: 'Done' })
      await last.scrollIntoViewIfNeeded()
      await expect(last).toBeVisible()

      // The card is reachable and announces itself the same way at every size.
      await expect(cardNamed(page, title).getByRole('button').first()).toBeVisible()
      await backend.rpc('delete_task', { p_task_id: taskId as string })
      await expect(cardNamed(page, title)).toHaveCount(0, { timeout: 20_000 })
    })
  })
}

/**
 * Pick a card up by its grip, carry it into a column and let it go.
 *
 * The same walk `tasks.spec.ts` uses: the column is re-measured as the card
 * travels, because a board narrower than its five columns scrolls itself while
 * something is dragged towards an edge.
 */
async function dragInto(page: Page, card: Locator, column: Locator): Promise<void> {
  await card.evaluate((element) => {
    element.scrollIntoView({ block: 'nearest', inline: 'center' })
  })
  await page.waitForTimeout(200)

  const grip = card.getByRole('button', { name: /^Reorder / })
  const from = await grip.boundingBox()
  if (!from) throw new Error('nothing to drag')

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()

  for (let i = 0; i < 14; i += 1) {
    const to = await column.boundingBox()
    const board = await page.locator('[data-board-scroller]').boundingBox()
    if (!to || !board) break
    const wanted = to.x + to.width / 2
    const x = Math.min(Math.max(wanted, board.x + 8), board.x + board.width - 8)
    await page.mouse.move(x, to.y + 60, { steps: 3 })
    if (Math.abs(wanted - x) < 4 && i > 1) break
    await page.waitForTimeout(120)
  }

  await page.mouse.up()
}

test.describe('a card that was just dragged', () => {
  test('stays where it was dropped when its own change comes back', async ({ page }) => {
    // A move publishes to everybody, including the client that made it. If
    // that echo were treated as news arriving mid-write, the board would
    // refetch the arrangement from before the move and the card would jump
    // back — which is the failure this whole reconciliation exists to prevent.
    const taskId = await addTask('dropped')
    const title = `${SCOPE} dropped ${RUN}`

    await openBoard(page)
    await expect(page.getByRole('listitem', { name: 'Todo' })).toContainText(title)

    await dragInto(page, cardNamed(page, title), page.getByRole('listitem', { name: 'Review' }))
    await expect(page.getByRole('listitem', { name: 'Review' })).toContainText(title, {
      timeout: 15_000,
    })

    // Long enough for the echo of this client's own write, and for anything
    // the rebalance published alongside it, to have arrived and been acted on.
    await page.waitForTimeout(4000)
    await expect(page.getByRole('listitem', { name: 'Review' })).toContainText(title)
    await expect(page.getByRole('listitem', { name: 'Todo' })).not.toContainText(title)

    const { data } = await backend.from('tasks').select('status').eq('id', taskId)
    expect(data?.[0]?.status).toBe('review')
    await backend.rpc('delete_task', { p_task_id: taskId })
  })
})
