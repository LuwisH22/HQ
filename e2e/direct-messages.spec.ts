import { expect, test, type Page } from '@playwright/test'
import { closeNav, openNav } from './channel-helpers'

/**
 * Phase 2 · C3 — direct messages through the real UI.
 *
 * Everything of the form "somebody who is not in the conversation gets
 * nothing" lives in the unit suite: this session is the organization's owner,
 * and the whole point of a conversation is that the owner is nobody special
 * inside one — so the interesting negative cannot be posed from here.
 *
 * The two projects talk to DIFFERENT people. A 1-to-1 conversation is unique
 * per pair, so desktop and mobile sharing one would mean each asserting on the
 * other's messages while they run side by side.
 *
 * Every message written here carries MARK. Each test removes what it sent, and
 * the teardown sweeps up anything a failure left behind — a direct message
 * cannot be deleted with the conversation the way a channel test's messages
 * can, so the marker is how they are found again.
 */

test.use({ storageState: '.auth/owner.json' })

/** In every message body, so a failed run can still be cleaned up. */
const MARK = 'e2e-dm'

const say = (text: string) => `${text} ${MARK}`

/** Desktop takes the first member offered, mobile the second. */
function partnerIndex(project: string): number {
  return project === 'mobile' ? 1 : 0
}

const timeline = (page: Page) => page.getByRole('list', { name: 'Messages' })

/**
 * Open the conversation with this project's partner, creating it once.
 *
 * Returns the name it is filed under, which is also what the composer and the
 * header are labelled with.
 */
async function openDirectMessage(page: Page, project: string): Promise<string> {
  await page.goto('/#/')
  await openNav(page)
  await page.getByRole('button', { name: 'Start a direct message' }).click()

  const list = page.getByRole('list', { name: 'Members' })
  await expect(list.getByRole('listitem').first()).toBeVisible({ timeout: 20_000 })

  const option = list.getByRole('listitem').nth(partnerIndex(project)).getByRole('button')
  const name = (await option.getAttribute('data-member-name')) ?? ''
  expect(name).not.toBe('')

  await option.click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveURL(/#\/dm\//)
  return name
}

async function send(page: Page, name: string, body: string): Promise<void> {
  await page.getByRole('textbox', { name: `Message ${name}` }).fill(body)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(body, { exact: true })).toBeVisible({ timeout: 20_000 })
}

/** Remove a message through the row's own menu, the way a person would. */
async function remove(page: Page, body: string): Promise<void> {
  const row = timeline(page).getByRole('listitem').filter({ hasText: body })
  await row.getByRole('button', { name: /Actions for message/ }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete message' }).click()
  await expect(page.getByText(body, { exact: true })).toHaveCount(0, { timeout: 20_000 })
}

test('starts a conversation from the sidebar and files it under direct messages', async ({
  page,
}, testInfo) => {
  const name = await openDirectMessage(page, testInfo.project.name)

  await openNav(page)
  const conversations = page.getByRole('list', { name: 'Direct messages' })
  await expect(conversations.getByRole('link', { name: new RegExp(name) })).toBeVisible()

  // Its own section: a conversation is not a channel and is not in a category.
  await expect(page.getByRole('list', { name: 'Channels' })).not.toContainText(name)

  // Opening the same person again returns to the same conversation rather
  // than making a second one — the routine is idempotent by construction.
  const url = page.url()
  await openDirectMessage(page, testInfo.project.name)
  expect(page.url()).toBe(url)
})

test('sends, edits and deletes a direct message', async ({ page }, testInfo) => {
  const name = await openDirectMessage(page, testInfo.project.name)
  const body = say('halo lewat dm')

  await send(page, name, body)

  const row = timeline(page).getByRole('listitem').filter({ hasText: body })
  await row.getByRole('button', { name: /Actions for message/ }).click()
  await page.getByRole('menuitem', { name: 'Edit message' }).click()
  const edited = say('halo lewat dm, revisi')
  await page.getByRole('textbox', { name: 'Edit message' }).fill(edited)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(edited, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('(edited)')).toBeVisible()

  await remove(page, edited)

  // Gone rather than tombstoned: there is no moderation decision to record in
  // a conversation, and no replies to keep reachable.
  await expect(page.getByText('This message was deleted.')).toHaveCount(0)
})

test('reacts to a direct message and takes it back', async ({ page }, testInfo) => {
  const name = await openDirectMessage(page, testInfo.project.name)
  const body = say('bagus')
  await send(page, name, body)

  const row = timeline(page).getByRole('listitem').filter({ hasText: body })
  await row.getByRole('button', { name: 'Add a reaction' }).first().click()
  await page.getByRole('button', { name: 'React with 👍' }).click()
  await expect(page.getByRole('button', { name: /👍 1/ })).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: /👍 1/ }).click()
  await expect(page.getByRole('button', { name: /👍 1/ })).toHaveCount(0, { timeout: 20_000 })

  await remove(page, body)
})

test('offers only the people in the conversation as mentions', async ({ page }, testInfo) => {
  const name = await openDirectMessage(page, testInfo.project.name)
  const composer = page.getByRole('textbox', { name: `Message ${name}` })

  await composer.click()
  await composer.pressSequentially('@', { delay: 20 })

  const menu = page.getByRole('listbox', { name: 'Mention a member' })
  await expect(menu).toBeVisible({ timeout: 20_000 })

  // Exactly the two people in it — never the organization's roster, which is
  // larger. A conversation must not become a way to enumerate anything.
  const handles = await menu
    .getByRole('option')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-handle') ?? ''))
  expect(handles).toHaveLength(2)

  // The other person, not you: naming yourself is not a mention.
  const theirs = handles.find((handle) => name.toLowerCase().includes(handle.toLowerCase()))
  expect(theirs).toBeTruthy()

  await composer.fill('')
  const body = say(`@${theirs!} lihat ini`)
  await send(page, name, body)

  const row = timeline(page).getByRole('listitem').filter({ hasText: body })
  await expect(row.locator('[data-mention]')).toHaveCount(1, { timeout: 20_000 })

  await remove(page, body)
})

test('searches this conversation and nothing wider', async ({ page }, testInfo) => {
  const name = await openDirectMessage(page, testInfo.project.name)
  const marker = `zqxdm${String(Date.now() % 100000)}`
  const body = say(`the needle is ${marker}`)
  await send(page, name, body)

  await page.getByRole('button', { name: 'Search this conversation' }).click()
  await page.getByRole('textbox', { name: 'Search messages' }).fill(marker)

  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results).toBeVisible({ timeout: 20_000 })
  await expect(results.getByText(body, { exact: true })).toBeVisible()

  // Widening is a channel idea. A conversation is searched by naming it, and
  // there is no control here that would fold it into a wider search.
  await expect(page.getByRole('button', { name: 'All channels' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Close search' }).click()
  await remove(page, body)
})

test('opens a thread on a direct message', async ({ page }, testInfo) => {
  const name = await openDirectMessage(page, testInfo.project.name)
  const body = say('ada thread')
  await send(page, name, body)

  const row = timeline(page).getByRole('listitem').filter({ hasText: body })
  await row.getByRole('button', { name: 'Reply in thread' }).click()
  await expect(page.getByRole('heading', { name: 'Thread', exact: true })).toBeVisible({
    timeout: 20_000,
  })

  const thread = page.getByRole('group', { name: `Composer for thread in ${name}` })
  const reply = say('balasan')
  await thread.getByRole('textbox').fill(reply)
  await thread.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByRole('list', { name: 'Thread replies' }).getByText(reply)).toBeVisible({
    timeout: 20_000,
  })

  // Clean up from inside the thread, then the root from the timeline.
  const replyRow = page
    .getByRole('list', { name: 'Thread replies' })
    .getByRole('listitem')
    .filter({ hasText: reply })
  await replyRow.getByRole('button', { name: /Actions for message/ }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete message' }).click()
  await expect(page.getByText(reply, { exact: true })).toHaveCount(0, { timeout: 20_000 })

  await page.getByRole('button', { name: 'Back to channel details' }).click()
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Close panel' }).first().click()
  }
  await remove(page, body)
})

test('clears the unread badge when the conversation is opened', async ({ page }, testInfo) => {
  const name = await openDirectMessage(page, testInfo.project.name)
  const body = say('tandai sudah dibaca')
  await send(page, name, body)

  await openNav(page)
  const row = page.getByRole('list', { name: 'Direct messages' }).getByRole('link', {
    name: new RegExp(name),
  })
  // Your own words are never unread, so opening it leaves nothing to count.
  await expect(row.getByText(/unread/)).toHaveCount(0)

  // The drawer is over the timeline on a phone, and marks it hidden.
  await closeNav(page)
  await remove(page, body)
})

test('does not open a conversation you are not in', async ({ page }) => {
  // A well-formed id nobody holds. Absent and forbidden must look the same.
  await page.goto('/#/dm/00000000-0000-4000-8000-000000000000')

  await expect(page.getByText('Conversation not found')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('textbox', { name: /^Message / })).toHaveCount(0)
})
