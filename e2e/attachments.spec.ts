import { expect, test, type Page } from '@playwright/test'
import { closeNav, createChannel, deleteChannel, openNav, uniqueName } from './channel-helpers'

/**
 * Phase 2 · C3 — attachments through the real UI.
 *
 * Everything of the form "somebody who cannot read the message gets no file"
 * lives in the unit suite: this session is the organization's owner, who can
 * see every channel by design.
 *
 * Each test removes what it sent. Deleting a message takes its metadata with
 * it and discards the objects the caller uploaded, so a passing run leaves
 * nothing in the bucket either.
 */

test.use({ storageState: '.auth/owner.json' })

/** A one-pixel PNG, small enough to be inline and real enough to render. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const picker = (page: Page) => page.getByLabel('Attach files')
const timeline = (page: Page) => page.getByRole('list', { name: 'Messages' })
const pendingList = (page: Page) => page.getByRole('list', { name: 'Attachments to send' })

async function attach(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await picker(page).setInputFiles(file)
}

async function send(page: Page, channel: string, body: string): Promise<void> {
  if (body !== '') await page.getByRole('textbox', { name: `Message ${channel}` }).fill(body)
  await page.getByRole('button', { name: 'Send message' }).click()
}

/** The row whose own words are this text, as against one quoting them. */
const rowFor = (page: Page, body: string) =>
  timeline(page)
    .getByRole('listitem')
    .filter({ has: page.locator('[data-message-body]', { hasText: body }) })

/** Remove a message through its own menu, which also discards its objects. */
async function remove(page: Page, hasText: string): Promise<void> {
  const row = rowFor(page, hasText)
  await row.getByRole('button', { name: /Actions for message/ }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete message' }).click()
  // First: a reply deleted earlier leaves its own placeholder in the flow.
  await expect(page.getByText('This message was deleted.').first()).toBeVisible({
    timeout: 20_000,
  })
}

test('offers an attachment control that takes the allowed kinds of file', async ({
  page,
}, testInfo) => {
  const name = uniqueName('attach', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  await expect(page.getByRole('button', { name: 'Attach file', exact: true })).toBeVisible()

  // The picker offers the four categories and nothing that could be executed.
  const accept = await picker(page).getAttribute('accept')
  expect(accept).toContain('image/png')
  expect(accept).toContain('application/pdf')
  expect(accept).toContain('text/plain')
  expect(accept).toContain('application/zip')
  expect(accept).not.toContain('text/html')

  await deleteChannel(page, name)
})

test('sends an image and renders it inline', async ({ page }, testInfo) => {
  const name = uniqueName('attachimg', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  await attach(page, { name: 'pixel.png', mimeType: 'image/png', buffer: PIXEL })

  // It uploads while the composer is still open, and says so.
  await expect(pendingList(page).getByText('pixel.png')).toBeVisible({ timeout: 20_000 })
  await expect(pendingList(page).getByText('Uploading…')).toHaveCount(0, { timeout: 20_000 })

  await send(page, name, 'here is a shot')
  await expect(page.getByText('here is a shot', { exact: true })).toBeVisible({ timeout: 20_000 })

  const row = timeline(page).getByRole('listitem').filter({ hasText: 'here is a shot' })
  const image = row.getByRole('img', { name: 'pixel.png' })
  await expect(image).toBeVisible({ timeout: 20_000 })

  // A signed URL against the private bucket, and the bytes actually arrive.
  const src = await image.getAttribute('src')
  expect(src).toContain('/storage/v1/object/sign/message-attachments/')
  await expect
    .poll(async () => image.evaluate((el: HTMLImageElement) => el.naturalWidth), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0)

  // The composer is clear again, ready for the next message.
  await expect(pendingList(page)).toHaveCount(0)

  await remove(page, 'here is a shot')
  await deleteChannel(page, name)
})

test('sends a document and offers it as a download', async ({ page }, testInfo) => {
  const name = uniqueName('attachdoc', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  await attach(page, {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('scrim notes\n'),
  })
  await expect(pendingList(page).getByText('notes.txt')).toBeVisible({ timeout: 20_000 })
  await expect(pendingList(page).getByText('Uploading…')).toHaveCount(0, { timeout: 20_000 })

  await send(page, name, 'the notes')
  await expect(page.getByText('the notes', { exact: true })).toBeVisible({ timeout: 20_000 })

  const row = timeline(page).getByRole('listitem').filter({ hasText: 'the notes' })
  const card = row.getByRole('link', { name: /Download notes\.txt/ })
  await expect(card).toBeVisible({ timeout: 20_000 })
  // Never drawn, never framed: a file card and a download, whatever it holds.
  await expect(row.getByRole('img')).toHaveCount(0)
  await expect(card).toHaveAttribute('download', 'notes.txt')

  const href = (await card.getAttribute('href')) ?? ''
  expect(href).toContain('/storage/v1/object/sign/message-attachments/')

  const response = await page.request.get(href)
  expect(response.status()).toBe(200)
  // The disposition is what keeps a file the browser might otherwise render a
  // download and nothing else.
  expect(response.headers()['content-disposition']).toContain('attachment')

  await remove(page, 'the notes')
  await deleteChannel(page, name)
})

test('refuses a file that is too large or the wrong kind', async ({ page }, testInfo) => {
  const name = uniqueName('attachno', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  await attach(page, {
    name: 'script.sh',
    mimeType: 'application/x-sh',
    buffer: Buffer.from('#!/bin/sh\n'),
  })
  await expect(page.getByText(/not a kind of file that can be attached/)).toBeVisible({
    timeout: 15_000,
  })
  await expect(pendingList(page)).toHaveCount(0)

  await attach(page, {
    name: 'huge.zip',
    mimeType: 'application/zip',
    // A byte over the limit, which is the interesting side of it.
    buffer: Buffer.alloc(25 * 1024 * 1024 + 1, 1),
  })
  await expect(page.getByText(/The limit is 25 MB/)).toBeVisible({ timeout: 20_000 })
  await expect(pendingList(page)).toHaveCount(0)

  await deleteChannel(page, name)
})

test('takes a pending attachment back before it is sent', async ({ page }, testInfo) => {
  const name = uniqueName('attachdrop', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  await attach(page, { name: 'pixel.png', mimeType: 'image/png', buffer: PIXEL })
  await expect(pendingList(page).getByText('pixel.png')).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Remove pixel.png' }).click()
  await expect(pendingList(page)).toHaveCount(0)

  // And with nothing to send, the button says so.
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled()

  await deleteChannel(page, name)
})

test('will not send a file with nothing said about it', async ({ page }, testInfo) => {
  const name = uniqueName('attachonly', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  await attach(page, { name: 'alone.png', mimeType: 'image/png', buffer: PIXEL })
  await expect(pendingList(page).getByText('alone.png')).toBeVisible({ timeout: 20_000 })

  // A message is words, and has been since C1 — the database says so with a
  // length check. An attachment accompanies a message rather than being one,
  // so the composer waits for something to be said.
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled()

  await page.getByRole('textbox', { name: `Message ${name}` }).fill('look at this')
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()

  await page.getByRole('button', { name: 'Remove alone.png' }).click()
  await deleteChannel(page, name)
})

test('attaches inside a private channel', async ({ page }, testInfo) => {
  const name = uniqueName('attachpriv', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { visibility: 'Private' })

  await attach(page, { name: 'secret.png', mimeType: 'image/png', buffer: PIXEL })
  await expect(pendingList(page).getByText('secret.png')).toBeVisible({ timeout: 20_000 })
  await expect(pendingList(page).getByText('Uploading…')).toHaveCount(0, { timeout: 20_000 })

  await send(page, name, 'classified shot')
  await expect(timeline(page).getByRole('img', { name: 'secret.png' })).toBeVisible({
    timeout: 20_000,
  })

  await remove(page, 'classified shot')
  await deleteChannel(page, name)
})

test('attaches to a thread reply', async ({ page }, testInfo) => {
  const name = uniqueName('attachthread', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  await send(page, name, 'the opening')
  await expect(page.getByText('the opening', { exact: true })).toBeVisible({ timeout: 20_000 })

  // The panel opens from a reply count, so there has to be one first.
  await rowFor(page, 'the opening')
    .getByRole('button', { name: /^Reply to / })
    .click()
  await page.getByRole('textbox', { name: `Message ${name}` }).fill('opening the thread')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('opening the thread', { exact: true })).toBeVisible({
    timeout: 20_000,
  })

  await rowFor(page, 'the opening')
    .getByRole('button', { name: /repl(y|ies)/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Thread', exact: true })).toBeVisible({
    timeout: 20_000,
  })

  // The thread has its own composer, and its own picker with it.
  const thread = page.getByRole('group', { name: `Composer for thread in ${name}` })
  await thread.getByLabel('Attach files').setInputFiles({
    name: 'reply.png',
    mimeType: 'image/png',
    buffer: PIXEL,
  })
  await expect(thread.getByText('reply.png')).toBeVisible({ timeout: 20_000 })
  await expect(thread.getByText('Uploading…')).toHaveCount(0, { timeout: 20_000 })

  await thread.getByRole('textbox').fill('with a file')
  await thread.getByRole('button', { name: 'Send message' }).click()

  const replies = page.getByRole('list', { name: 'Thread replies' })
  await expect(replies.getByRole('img', { name: 'reply.png' })).toBeVisible({ timeout: 20_000 })

  const reply = replies.getByRole('listitem').filter({ hasText: 'with a file' })
  await reply.getByRole('button', { name: /Actions for message/ }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete message' }).click()
  await expect(replies.getByText('with a file')).toHaveCount(0, { timeout: 20_000 })

  await page.getByRole('button', { name: 'Back to channel details' }).click()
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Close panel' }).first().click()
  }
  await remove(page, 'the opening')
  await deleteChannel(page, name)
})

test('attaches inside a direct message', async ({ page }, testInfo) => {
  await page.goto('/#/')
  await openNav(page)
  await page.getByRole('button', { name: 'Start a direct message' }).click()

  const list = page.getByRole('list', { name: 'Members' })
  await expect(list.getByRole('listitem').first()).toBeVisible({ timeout: 20_000 })
  // The same split the direct message spec uses, so the two projects do not
  // write into one another's conversation while they run side by side.
  const option = list
    .getByRole('listitem')
    .nth(testInfo.project.name === 'mobile' ? 1 : 0)
    .getByRole('button')
  const name = (await option.getAttribute('data-member-name')) ?? ''
  await option.click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 20_000 })

  await closeNav(page)
  await attach(page, { name: 'dm.png', mimeType: 'image/png', buffer: PIXEL })
  await expect(pendingList(page).getByText('dm.png')).toBeVisible({ timeout: 20_000 })
  // Wait for the upload rather than for the card: the card appears the moment
  // the file is chosen, and sending before it lands sends a message with
  // nothing on it.
  await expect(pendingList(page).getByText('Uploading…')).toHaveCount(0, { timeout: 20_000 })

  await send(page, name, 'a file for you e2e-dm')
  await expect(timeline(page).getByRole('img', { name: 'dm.png' })).toBeVisible({ timeout: 20_000 })

  // A direct message with no replies goes outright, and takes the file with it.
  const row = timeline(page).getByRole('listitem').filter({ hasText: 'a file for you e2e-dm' })
  await row.getByRole('button', { name: /Actions for message/ }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete message' }).click()
  await expect(page.getByText('a file for you e2e-dm')).toHaveCount(0, { timeout: 20_000 })
})
