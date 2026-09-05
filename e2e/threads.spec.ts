import { expect, test, type Page } from '@playwright/test'
import { createChannel, deleteChannel, uniqueName } from './channel-helpers'

/**
 * Phase 2 · C3 — threads through the real UI.
 *
 * Everything of the form "somebody who cannot see the channel gets nothing"
 * lives in the unit suite: this session is the organization owner, who
 * short-circuits every check by design.
 */

test.use({ storageState: '.auth/owner.json' })

async function send(page: Page, channel: string, body: string): Promise<void> {
  await page.getByRole('textbox', { name: `Message ${channel}` }).fill(body)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(body)).toBeVisible({ timeout: 15_000 })
}

/** The panel is a column on desktop and a sheet on a phone; both open here. */
async function openThreadOn(page: Page, body: string): Promise<void> {
  const row = page
    .getByRole('list', { name: 'Messages' })
    .getByRole('listitem')
    .filter({ hasText: body })
  await row.getByRole('button', { name: 'Reply in thread' }).click()
  await expect(page.getByRole('heading', { name: 'Thread', exact: true })).toBeVisible({
    timeout: 15_000,
  })
}

/**
 * Leave the thread and get back to the conversation.
 *
 * On a phone the panel is a sheet over the messages, and it marks them hidden
 * while it is open — so returning to the channel details is not enough, the
 * sheet has to go too.
 */
async function leaveThread(page: Page, project: string): Promise<void> {
  await page.getByRole('button', { name: 'Back to channel details' }).click()
  if (project === 'mobile') {
    await page.getByRole('button', { name: 'Close panel' }).first().click()
  }
}

async function replyInThread(page: Page, channel: string, body: string): Promise<void> {
  // Scoped to the thread's own composer: two are on screen once a thread is
  // open, and "the last Send button" is not a thing to rely on.
  const composer = page.getByRole('group', { name: `Composer for thread in ${channel}` })
  await composer.getByRole('textbox').fill(body)
  await composer.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByRole('list', { name: 'Thread replies' }).getByText(body)).toBeVisible({
    timeout: 15_000,
  })
}

test('replies to a message and counts the thread', async ({ page }, testInfo) => {
  const name = uniqueName('thread', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'Scrim besok jam 8.')

  await openThreadOn(page, 'Scrim besok jam 8.')
  await replyInThread(page, name, 'Against RRQ?')
  await replyInThread(page, name, 'Iya.')
  await leaveThread(page, testInfo.project.name)

  // The count lands on the message in the timeline, not only in the panel.
  await expect(page.getByRole('button', { name: /2 replies/ })).toBeVisible({ timeout: 15_000 })

  // A reply belongs to its thread; the timeline stays a list of openings.
  const timeline = page.getByRole('list', { name: 'Messages' })
  await expect(timeline.getByText('Against RRQ?')).toHaveCount(0)

  await deleteChannel(page, name)
})

test('returns from a thread to the channel details', async ({ page }, testInfo) => {
  const name = uniqueName('threadback', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'root message')

  await openThreadOn(page, 'root message')
  await page.getByRole('button', { name: 'Back to channel details' }).click()

  // The same panel, back to what it was. There is no fourth column.
  await expect(page.getByRole('heading', { name: 'Thread', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible({ timeout: 15_000 })

  await deleteChannel(page, name)
})

test('reopens a thread from its reply count', async ({ page }, testInfo) => {
  const name = uniqueName('threadcount', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'countable root')

  await openThreadOn(page, 'countable root')
  await replyInThread(page, name, 'first reply')
  await leaveThread(page, testInfo.project.name)

  await page.getByRole('button', { name: /1 reply/ }).click()
  await expect(page.getByRole('heading', { name: 'Thread', exact: true })).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    page.getByRole('list', { name: 'Thread replies' }).getByText('first reply'),
  ).toBeVisible()

  await deleteChannel(page, name)
})

test('keeps the thread when the root is deleted, and takes no new replies', async ({
  page,
}, testInfo) => {
  const name = uniqueName('threaddel', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'about to go')

  await openThreadOn(page, 'about to go')
  await replyInThread(page, name, 'reply survives')
  await leaveThread(page, testInfo.project.name)

  const row = page
    .getByRole('list', { name: 'Messages' })
    .getByRole('listitem')
    .filter({ hasText: 'about to go' })
  await row.getByRole('button', { name: /Actions for message/ }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete message' }).click()
  await expect(page.getByText('This message was deleted.')).toBeVisible({ timeout: 15_000 })

  // The thread is still reachable from its count, and the composer is gone.
  await page.getByRole('button', { name: /1 reply/ }).click()
  await expect(
    page.getByRole('list', { name: 'Thread replies' }).getByText('reply survives'),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('The thread stays, but it takes no new replies.')).toBeVisible()

  await deleteChannel(page, name)
})

test('finds a reply in search', async ({ page }, testInfo) => {
  const name = uniqueName('threadsearch', testInfo.project.name)
  const marker = `zqxjv${String(Date.now() % 100000)}`
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'search root')

  await openThreadOn(page, 'search root')
  await replyInThread(page, name, `the needle is ${marker}`)
  await leaveThread(page, testInfo.project.name)

  await page.getByRole('button', { name: 'Search this channel' }).click()
  await page.getByRole('textbox', { name: 'Search messages' }).fill(marker)

  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results).toBeVisible({ timeout: 20_000 })
  await expect(results.getByText(`the needle is ${marker}`)).toBeVisible()
  // The result says where it lives, or opening it lands somewhere the text is not.
  await expect(results.getByText('in a thread').first()).toBeVisible()

  await page.getByRole('button', { name: 'Close search' }).click()
  await deleteChannel(page, name)
})

test('reacts to a reply inside the thread', async ({ page }, testInfo) => {
  const name = uniqueName('threadreact', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'react root')

  await openThreadOn(page, 'react root')
  await replyInThread(page, name, 'good call')

  const reply = page
    .getByRole('list', { name: 'Thread replies' })
    .getByRole('listitem')
    .filter({ hasText: 'good call' })
  await reply.getByRole('button', { name: 'Add a reaction' }).first().click()
  await page.getByRole('button', { name: 'React with 👍' }).click()

  await expect(page.getByRole('button', { name: /👍 1/ })).toBeVisible({ timeout: 15_000 })

  await deleteChannel(page, name)
})
