import { expect, test, type Page } from '@playwright/test'
import { createChannel, deleteChannel, openNav, uniqueName } from './channel-helpers'

/**
 * Phase 2 · C3 — replying in the room rather than beside it.
 *
 * Reply keeps you where you are: the composer takes a line saying what is
 * being answered, the answer is typed where everything else is typed, and the
 * message that lands carries the same line above its words. The thread panel
 * is still there, reached from a reply count, and it holds the same rows read
 * a second way.
 *
 * Everything of the form "somebody who cannot see the parent gets nothing"
 * lives in the unit suite: this session is the organization's owner.
 */

test.use({ storageState: '.auth/owner.json' })

const timeline = (page: Page) => page.getByRole('list', { name: 'Messages' })
const threadHeading = (page: Page) => page.getByRole('heading', { name: 'Thread', exact: true })
const replyBar = (page: Page) => page.getByLabel('Replying to')

/**
 * The row whose own words are this text.
 *
 * Matched on the body rather than on the row: a reply also carries a line
 * quoting what it answers, and a match on the row cannot tell the two apart.
 */
const rowFor = (page: Page, body: string) =>
  timeline(page)
    .getByRole('listitem')
    .filter({ has: page.locator('[data-message-body]', { hasText: body }) })

async function send(page: Page, place: string, body: string): Promise<void> {
  await page.getByRole('textbox', { name: `Message ${place}` }).fill(body)
  await page.getByRole('button', { name: 'Send message' }).click()
  // On the row rather than on the text: once anything replies to this
  // message, its words appear a second time inside the quote above the reply,
  // and a bare text match cannot tell the two apart.
  await expect(rowFor(page, body).first()).toBeVisible({ timeout: 20_000 })
}

/** Start a reply on the message with this body. */
async function startReply(page: Page, body: string): Promise<void> {
  await rowFor(page, body)
    .getByRole('button', { name: /^Reply to / })
    .click()
  await expect(replyBar(page)).toBeVisible({ timeout: 10_000 })
}

async function replyTo(page: Page, place: string, target: string, body: string): Promise<void> {
  await startReply(page, target)
  await page.getByRole('textbox', { name: `Message ${place}` }).fill(body)
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(rowFor(page, body).first()).toBeVisible({ timeout: 20_000 })
}

test('replies in the room and never opens the thread panel', async ({ page }, testInfo) => {
  const name = uniqueName('inline', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'scrim at eight')

  await startReply(page, 'scrim at eight')

  // The whole point: Reply does not take you anywhere.
  await expect(threadHeading(page)).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: `Message ${name}` })).toBeFocused()

  // The bar says who is being answered, and what they said.
  await expect(replyBar(page)).toContainText('scrim at eight')

  await page.getByRole('textbox', { name: `Message ${name}` }).fill('iya anjir')
  await page.getByRole('button', { name: 'Send message' }).click()

  // The reply lands in the flow, carrying its context above its words.
  const reply = rowFor(page, 'iya anjir')
  await expect(reply).toBeVisible({ timeout: 20_000 })
  await expect(reply.getByRole('button', { name: /^Go to the message/ })).toContainText(
    'scrim at eight',
  )
  await expect(threadHeading(page)).toHaveCount(0)

  // Sending clears the reply, so the next message is not one too.
  await expect(replyBar(page)).toHaveCount(0)

  // One level, which is what the database allows: a reply takes no reply.
  await expect(reply.getByRole('button', { name: /^Reply to / })).toHaveCount(0)

  // And the thread is still there, behind the count, holding the same reply.
  await rowFor(page, 'scrim at eight')
    .getByRole('button', { name: /1 reply/ })
    .click()
  await expect(threadHeading(page)).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByRole('list', { name: 'Thread replies' }).getByText('iya anjir'),
  ).toBeVisible()

  await deleteChannel(page, name)
})

test('keeps the draft through starting and cancelling a reply', async ({ page }, testInfo) => {
  const name = uniqueName('inlinedraft', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'the root')

  const field = page.getByRole('textbox', { name: `Message ${name}` })
  await field.fill('half a thought')

  // Entering reply mode is not allowed to cost anybody their words.
  await startReply(page, 'the root')
  await expect(field).toHaveValue('half a thought')

  await page.getByRole('button', { name: 'Cancel reply' }).click()
  await expect(replyBar(page)).toHaveCount(0)
  await expect(field).toHaveValue('half a thought')

  // And what is sent afterwards is an ordinary message, quoting nothing.
  await page.getByRole('button', { name: 'Send message' }).click()
  const sent = rowFor(page, 'half a thought')
  await expect(sent).toBeVisible({ timeout: 20_000 })
  await expect(sent.getByRole('button', { name: /^Go to the message/ })).toHaveCount(0)
  // Cancelled means cancelled: the root took no reply at all.
  await expect(rowFor(page, 'the root').getByRole('button', { name: /reply/ })).toHaveCount(0)

  await deleteChannel(page, name)
})

test('follows a quote back to the message it answers', async ({ page }, testInfo) => {
  const name = uniqueName('inlinejump', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'the first word')

  // Enough between them that the parent is a scroll away.
  for (let i = 0; i < 8; i += 1) await send(page, name, `filler line ${String(i)}`)

  await replyTo(page, name, 'the first word', 'answering the first')

  const parent = rowFor(page, 'the first word')
  await rowFor(page, 'answering the first')
    .getByRole('button', { name: /^Go to the message/ })
    .click()

  await expect(parent).toBeInViewport({ timeout: 10_000 })
  await expect(parent).toHaveAttribute('data-highlighted', 'true')
  // A jump is not a thread.
  await expect(threadHeading(page)).toHaveCount(0)

  // The mark fades on its own rather than becoming a second kind of pin.
  await expect(parent).not.toHaveAttribute('data-highlighted', 'true', { timeout: 10_000 })

  await deleteChannel(page, name)
})

test('shows a deleted parent as deleted, and nothing else', async ({ page }, testInfo) => {
  const name = uniqueName('inlinegone', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'about to go')
  await replyTo(page, name, 'about to go', 'reply outlives it')

  const parent = rowFor(page, 'about to go')
  await parent.getByRole('button', { name: /Actions for message/ }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete message' }).click()
  await expect(page.getByText('This message was deleted.').first()).toBeVisible({ timeout: 20_000 })

  // The quote says the words are gone rather than keeping a copy of them.
  const quote = rowFor(page, 'reply outlives it').getByRole('button', {
    name: /^Go to the message/,
  })
  await expect(quote).toContainText('This message was deleted.')
  await expect(quote).not.toContainText('about to go')

  await deleteChannel(page, name)
})

test('fits a narrow screen without overflowing it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'about the phone layout')

  const name = uniqueName('inlinenarrow', testInfo.project.name)
  const long = 'a long opening message that runs well past the width of a phone and keeps going'
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, long)
  await startReply(page, long)

  const overflowing = () =>
    page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

  expect(await overflowing()).toBe(false)

  await page.getByRole('textbox', { name: `Message ${name}` }).fill('short')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(rowFor(page, 'short')).toBeVisible({ timeout: 20_000 })

  // Both the bar and the quoted line truncate rather than pushing the page.
  expect(await overflowing()).toBe(false)

  await deleteChannel(page, name)
})

test('replies inside a direct message', async ({ page }, testInfo) => {
  const MARK = 'e2e-inline-dm'
  await page.goto('/#/')
  await openNav(page)
  await page.getByRole('button', { name: 'Start a direct message' }).click()

  const list = page.getByRole('list', { name: 'Members' })
  await expect(list.getByRole('listitem').first()).toBeVisible({ timeout: 20_000 })
  // The two projects talk to different people: a 1-to-1 conversation is
  // unique per pair, and they run side by side.
  const option = list
    .getByRole('listitem')
    .nth(testInfo.project.name === 'mobile' ? 1 : 0)
    .getByRole('button')
  const name = (await option.getAttribute('data-member-name')) ?? ''
  await option.click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 20_000 })

  const root = `dm root ${MARK}`
  const answer = `dm answer ${MARK}`
  await send(page, name, root)
  await replyTo(page, name, root, answer)

  const reply = rowFor(page, answer)
  await expect(reply.getByRole('button', { name: /^Go to the message/ })).toContainText(root)
  await expect(threadHeading(page)).toHaveCount(0)

  // Taken back down: a direct message outlives the test otherwise.
  for (const body of [answer, root]) {
    const row = rowFor(page, body)
    await row.getByRole('button', { name: /Actions for message/ }).click()
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('menuitem', { name: 'Delete message' }).click()
    await expect(page.getByText(body, { exact: true })).toHaveCount(0, { timeout: 20_000 })
  }
})
