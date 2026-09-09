import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The board, against real tasks.
 *
 * Fixtures are made through the same guarded routines the UI calls, from a
 * second client signed in as the same account. Dragging is done with the mouse
 * rather than simulated: the card is picked up by its grip, carried across the
 * board and let go, and what is asserted afterwards is the row in the database.
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

let SCOPE = 'E2E task'
let RUN = ''
let backend: SupabaseClient
let organizationId: string
/** One project for the whole file, made fresh and archived at the end. */
let projectId = ''

test.beforeAll(async () => {
  SCOPE = `E2E task ${test.info().project.name}`
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

async function rowOf(taskId: string) {
  const { data } = await backend
    .from('tasks')
    .select('title, status, priority, due_date, assignee_id, position, completed_at')
    .eq('id', taskId)
  return (data ?? [])[0]
}

async function openBoard(page: Page): Promise<void> {
  await page.goto(`/#/projects/${projectId}`)
  await expect(page.getByRole('list', { name: 'Board' })).toBeVisible({ timeout: 20_000 })
}

const columnNamed = (page: Page, name: string) => page.getByRole('listitem', { name })
const cardNamed = (page: Page, title: string) =>
  page.locator('[data-task-id]').filter({ hasText: title })

/**
 * Pick a card up by its grip, carry it into a column and let it go.
 *
 * The column is re-measured as the card travels, because a board narrower than
 * its five columns scrolls itself while something is being dragged towards an
 * edge — so where the target was when the drag started is not where it is when
 * the card arrives.
 */
async function dragInto(page: Page, card: Locator, column: Locator, offsetY = 60): Promise<void> {
  // On a narrow board a column is only half on screen, and the grip sits at
  // the right edge of its card — so the column is scrolled to the middle
  // first, which is what the snap points invite a person to do anyway.
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

    // Aim for the column, but never past the edge of the board — that is
    // where the drag's own scrolling happens.
    const wanted = to.x + to.width / 2
    const x = Math.min(Math.max(wanted, board.x + 8), board.x + board.width - 8)
    await page.mouse.move(x, to.y + offsetY, { steps: 3 })

    const arrived = Math.abs(wanted - x) < 4
    if (arrived && i > 1) break
    await page.waitForTimeout(120)
  }

  await page.mouse.up()
}

test.describe('an empty board', () => {
  test('shows the five columns, and says each is empty', async ({ page }) => {
    await openBoard(page)

    for (const name of ['Backlog', 'Todo', 'In progress', 'Review', 'Done']) {
      await expect(columnNamed(page, name)).toBeVisible()
    }
    await expect(page.getByText('Nothing')).toHaveCount(5)
    // No roadmap language anywhere on a board with nothing on it.
    await expect(page.getByText(/coming soon|phase/i)).toHaveCount(0)
  })
})

test.describe('adding work', () => {
  test('creates a task in the column the plus was pressed in', async ({ page }) => {
    const title = `${SCOPE} written here ${RUN}`
    await openBoard(page)

    await columnNamed(page, 'Review').getByRole('button', { name: 'New task in Review' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'New task' })).toBeVisible()
    // The column it opens in is the one the plus belonged to.
    await expect(dialog.getByLabel('Column')).toHaveText('Review')

    await dialog.getByLabel('Title').fill(title)
    await dialog.getByLabel('Priority').click()
    await page.getByRole('option', { name: 'High', exact: true }).click()
    await dialog.getByLabel('Due').fill('2026-10-01')
    await dialog.getByRole('button', { name: 'Add task' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    await expect(columnNamed(page, 'Review').getByText(title)).toBeVisible({ timeout: 15_000 })

    const { data } = await backend
      .from('tasks')
      .select('status, priority, due_date')
      .eq('title', title)
    expect(data?.[0]?.status).toBe('review')
    expect(data?.[0]?.priority).toBe('high')
    expect(data?.[0]?.due_date).toBe('2026-10-01')
  })

  test('will not add one with no title', async ({ page }) => {
    await openBoard(page)
    await columnNamed(page, 'Todo').getByRole('button', { name: 'New task in Todo' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Add task' }).click()

    await expect(page.getByText('A title is required')).toBeVisible()
    await expect(dialog).toBeVisible()
  })
})

test.describe('one task', () => {
  test('opens, changes and is saved', async ({ page }) => {
    const id = await addTask('editable', { p_priority: 'low' })
    await openBoard(page)

    await cardNamed(page, `${SCOPE} editable`).getByRole('button').first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Title')).toHaveValue(`${SCOPE} editable`)
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    await dialog.getByLabel('Title').fill(`${SCOPE} rewritten`)
    await dialog.getByLabel('Priority').click()
    await page.getByRole('option', { name: 'Urgent', exact: true }).click()
    await dialog.getByLabel('Due').fill('2026-11-05')
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    const row = await rowOf(id)
    expect(row?.title).toBe(`${SCOPE} rewritten`)
    expect(row?.priority).toBe('urgent')
    expect(row?.due_date).toBe('2026-11-05')
  })

  test('is put on somebody, and taken off again', async ({ page }) => {
    const id = await addTask('assignable')
    const { data: members } = await backend
      .from('project_members')
      .select('member_id')
      .eq('project_id', projectId)
    const member = (members ?? [])[0]?.member_id as string | undefined
    test.skip(!member, 'Nobody is on this project.')

    await openBoard(page)
    await cardNamed(page, `${SCOPE} assignable`).getByRole('button').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Assignee').click()
    await page.getByRole('option').nth(1).click()
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(async () => (await rowOf(id))?.assignee_id, { timeout: 15_000 }).toBe(member)
  })

  test('is deleted, and the record of it outlives it', async ({ page }) => {
    const id = await addTask('doomed')
    await openBoard(page)

    await cardNamed(page, `${SCOPE} doomed`).getByRole('button').first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 })
    await expect(cardNamed(page, `${SCOPE} doomed`)).toHaveCount(0)
    expect(await rowOf(id)).toBeUndefined()

    const { data: audit } = await backend
      .from('audit_logs')
      .select('action')
      .eq('entity_type', 'task')
      .eq('entity_id', id)
      .eq('action', 'task.deleted')
    expect(audit).toHaveLength(1)
  })
})

test.describe('moving work', () => {
  test('carries a card from Todo into In progress', async ({ page }) => {
    const id = await addTask('travelling')
    await openBoard(page)

    await dragInto(page, cardNamed(page, `${SCOPE} travelling`), columnNamed(page, 'In progress'))

    // The card is there before the round trip finishes, and the row agrees
    // once it does.
    await expect(columnNamed(page, 'In progress').getByText(`${SCOPE} travelling`)).toBeVisible()
    await expect
      .poll(async () => (await rowOf(id))?.status, { timeout: 15_000 })
      .toBe('in_progress')
  })

  test('stamps a task finished on the way into Done, and clears it coming back', async ({
    page,
  }) => {
    const id = await addTask('finishing')
    await openBoard(page)

    await dragInto(page, cardNamed(page, `${SCOPE} finishing`), columnNamed(page, 'Done'))
    await expect.poll(async () => (await rowOf(id))?.status, { timeout: 15_000 }).toBe('done')
    expect((await rowOf(id))?.completed_at).not.toBeNull()

    await dragInto(page, cardNamed(page, `${SCOPE} finishing`), columnNamed(page, 'Review'))
    await expect.poll(async () => (await rowOf(id))?.status, { timeout: 15_000 }).toBe('review')
    // Never both: the constraint in Postgres refuses it and the routine keeps
    // the two in step.
    expect((await rowOf(id))?.completed_at).toBeNull()
  })

  test('reorders inside one column', async ({ page }) => {
    const first = await addTask('one')
    await addTask('two')
    const third = await addTask('three')
    await openBoard(page)

    const positions = async () => {
      const { data } = await backend
        .from('tasks')
        .select('id, title')
        .eq('project_id', projectId)
        .eq('status', 'todo')
        .order('position')
      return (data ?? []).map((row) => row.id as string)
    }
    expect(await positions()).toEqual([first, expect.any(String), third])

    // Drop the third card at the top of its own column.
    await dragInto(page, cardNamed(page, `${SCOPE} three`), columnNamed(page, 'Todo'), 34)
    await expect.poll(async () => (await positions())[0], { timeout: 15_000 }).toBe(third)
  })

  test('moves a card with the keyboard alone, and says what it did', async ({ page }) => {
    // The board is a drag surface, and a drag surface that only answers to a
    // pointer is a board some people cannot use. Picking a card up, carrying
    // it and putting it down all have keys, and each step is announced —
    // otherwise a screen reader hears a card silently leave the page.
    const id = await addTask('by keyboard')
    await openBoard(page)

    const grip = cardNamed(page, `${SCOPE} by keyboard`).getByRole('button', {
      name: /^Reorder /,
    })
    await grip.focus()
    await expect(grip).toBeFocused()

    // The board's own announcement, not the toast region, which is also live.
    const said = page.locator('p.sr-only[aria-live="polite"]')
    await grip.press(' ')
    await expect(said).toContainText(/picked up/i)
    await expect(said).toContainText(/Todo/)

    // Two columns to the right, then let it go.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(said).toContainText(/Review/)
    await page.keyboard.press(' ')

    await expect.poll(async () => (await rowOf(id))?.status, { timeout: 15_000 }).toBe('review')
    await expect(columnNamed(page, 'Review')).toContainText(`${SCOPE} by keyboard`)
  })

  test('puts a card back where it was when the carry is abandoned', async ({ page }) => {
    const id = await addTask('escaped')
    await openBoard(page)

    const grip = cardNamed(page, `${SCOPE} escaped`).getByRole('button', { name: /^Reorder / })
    await grip.focus()
    await grip.press(' ')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')

    await expect(page.locator('p.sr-only[aria-live="polite"]')).toContainText(/put back/i)
    await expect(columnNamed(page, 'Todo')).toContainText(`${SCOPE} escaped`)
    // Nothing was written: an abandoned carry is not a move.
    expect((await rowOf(id))?.status).toBe('todo')
  })

  test('puts a card back when the server refuses the move', async ({ page }) => {
    const id = await addTask('refused')
    await openBoard(page)

    // Every move refused, however it is asked.
    await page.route('**/rest/v1/rpc/move_task', (route) =>
      route.fulfill({ status: 403, body: '{"message":"nope","code":"42501"}' }),
    )

    await dragInto(page, cardNamed(page, `${SCOPE} refused`), columnNamed(page, 'Done'))

    // It goes back where it was, says why, and the row never moved.
    await expect(columnNamed(page, 'Todo').getByText(`${SCOPE} refused`)).toBeVisible({
      timeout: 15_000,
    })
    await expect(columnNamed(page, 'Done').getByText(`${SCOPE} refused`)).toHaveCount(0)
    expect((await rowOf(id))?.status).toBe('todo')
  })

  test('moves a task from its own detail, and the column follows', async ({ page }) => {
    const id = await addTask('by hand')
    await openBoard(page)

    await cardNamed(page, `${SCOPE} by hand`).getByRole('button').first().click()
    await page.getByRole('dialog').getByLabel('Column').click()
    await page.getByRole('option', { name: 'Backlog', exact: true }).click()

    await expect.poll(async () => (await rowOf(id))?.status, { timeout: 15_000 }).toBe('backlog')
  })
})

test.describe('an archived project', () => {
  test('keeps its work, and takes nothing new', async ({ page }) => {
    await addTask('kept')
    await backend.rpc('archive_project', { p_project_id: projectId })

    try {
      await openBoard(page)

      // The work is all still there and still readable.
      await expect(cardNamed(page, `${SCOPE} kept`)).toBeVisible()

      // And nothing is offered that the database would refuse.
      await expect(page.getByRole('button', { name: /^New task in / })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Reorder / })).toHaveCount(0)

      await cardNamed(page, `${SCOPE} kept`).getByRole('button').first().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled()
      await expect(dialog.getByRole('button', { name: 'Delete' })).toHaveCount(0)
    } finally {
      // Its own routine since 6.5: un-archiving was never really an edit.
      await backend.rpc('restore_project', { p_project_id: projectId })
    }
  })
})

test.describe('narrow screens', () => {
  for (const width of [390, 412]) {
    test(`fits ${String(width)}px, and still moves work`, async ({ page }) => {
      const id = await addTask(`narrow ${String(width)}`)
      await page.setViewportSize({ width, height: 844 })
      await openBoard(page)

      const overflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflowing, `the board at ${String(width)}px`).toBe(false)

      // The board itself scrolls sideways: five columns, one small screen.
      const scrolls = await page.evaluate(() => {
        const board = document.querySelector('[data-board-scroller]')
        return board ? board.scrollWidth > board.clientWidth : false
      })
      expect(scrolls, 'the board should scroll sideways').toBe(true)

      // And a card can still be carried to a column that starts off-screen:
      // the board comes along with it.
      await dragInto(page, cardNamed(page, `${SCOPE} narrow`), columnNamed(page, 'In progress'))
      await expect
        .poll(async () => (await rowOf(id))?.status, { timeout: 15_000 })
        .toBe('in_progress')
    })
  }
})
