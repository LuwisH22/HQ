import { expect, test, type Page } from '@playwright/test'
import {
  createChannel as createChannelViaSidebar,
  deleteChannel,
  main,
  openNav,
  uniqueName as uniqueChannelName,
} from './channel-helpers'

/**
 * Phase 2 · C1 — chat through the real UI.
 *
 * Each run works in its own channel, created and deleted here: the desktop and
 * mobile projects run concurrently against the same organization, and sharing
 * a channel would mean asserting on each other's messages.
 */

test.use({ storageState: '.auth/owner.json' })

function uniqueName(project: string): string {
  return uniqueChannelName('chat', project)
}

/** Create a channel and land in its conversation. */
async function createChannel(page: Page, name: string): Promise<void> {
  await page.goto('/#/')
  await createChannelViaSidebar(page, name)
}

async function openChannel(page: Page, name: string): Promise<void> {
  await page.goto('/#/channels')
  await expect(page.getByRole('heading', { name: 'Channels', level: 1 })).toBeVisible({
    timeout: 20_000,
  })
  await main(page).getByRole('link').filter({ hasText: name }).first().click()
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 })
}

test('opens and switches channels from the navigation', async ({ page }, testInfo) => {
  const first = uniqueName(testInfo.project.name)
  const second = `${uniqueName(testInfo.project.name)}-alt`
  await createChannel(page, first)
  await createChannel(page, second)

  // Starting somewhere else entirely: reaching a conversation must not mean
  // going through the directory first.
  await page.goto('/#/')
  await openNav(page)
  await page.getByRole('link', { name: first, exact: true }).click()
  await expect(page.getByRole('heading', { name: first })).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/#\/channels\//)

  // And switching is one click, from inside the conversation.
  await openNav(page)
  await page.getByRole('link', { name: second, exact: true }).click()
  await expect(page.getByRole('heading', { name: second })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('textbox', { name: `Message ${second}` })).toBeVisible()

  await deleteChannel(page, first)
  await deleteChannel(page, second)
})

test('sends a message with Enter and keeps Shift+Enter for a new line', async ({
  page,
}, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  const composer = page.getByRole('textbox', { name: `Message ${name}` })
  await composer.click()
  await composer.pressSequentially('first line')
  await composer.press('Shift+Enter')
  await composer.pressSequentially('second line')

  // Still a draft: Shift+Enter breaks the line rather than sending.
  await expect(page.getByText('No messages yet')).toBeVisible()
  // Written as a pattern rather than a literal so the newline between the two
  // lines is the thing under test, not something to escape into the source.
  await expect(composer).toHaveValue(/^first line\s+second line$/)

  await composer.press('Enter')
  await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('listitem').filter({ hasText: 'second line' })).toBeVisible()
  await expect(composer).toHaveValue('')

  await deleteChannel(page, name)
})

test('sends, edits and deletes a message', async ({ page }, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  const composer = page.getByRole('textbox', { name: `Message ${name}` })

  await expect(page.getByText('No messages yet')).toBeVisible()

  await composer.fill('first message from the suite')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('first message from the suite')).toBeVisible({ timeout: 15_000 })

  // The composer clears itself, so a second send is not a duplicate.
  await expect(composer).toHaveValue('')

  const row = page.getByRole('listitem').filter({ hasText: 'first message from the suite' })
  await row.getByRole('button', { name: /Actions for message/ }).click()
  await page.getByRole('menuitem', { name: 'Edit message' }).click()

  const editor = page.getByRole('textbox', { name: 'Edit message' })
  await editor.fill('edited by the suite')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByText('edited by the suite')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('(edited)')).toBeVisible()

  // Soft delete: the row stays, the words go.
  const edited = page.getByRole('listitem').filter({ hasText: 'edited by the suite' })
  await edited.getByRole('button', { name: /Actions for message/ }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete message' }).click()

  await expect(page.getByText('This message was deleted.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('edited by the suite')).toHaveCount(0)

  await deleteChannel(page, name)
})

test('pins and unpins a message', async ({ page }, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  await page.getByRole('textbox', { name: `Message ${name}` }).fill('worth pinning')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('worth pinning')).toBeVisible({ timeout: 15_000 })

  const row = page.getByRole('listitem').filter({ hasText: 'worth pinning' })
  await row.getByRole('button', { name: /Actions for message/ }).click()
  await page.getByRole('menuitem', { name: 'Pin message' }).click()
  await expect(page.getByLabel('Pinned')).toBeVisible({ timeout: 15_000 })

  const pinned = page.getByRole('listitem').filter({ hasText: 'worth pinning' })
  await pinned.getByRole('button', { name: /Actions for message/ }).click()
  await page.getByRole('menuitem', { name: 'Unpin message' }).click()
  await expect(page.getByLabel('Pinned')).toHaveCount(0, { timeout: 15_000 })

  await deleteChannel(page, name)
})

test('never shows your own typing indicator back to you', async ({ page }, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  // Typing is broadcast with `self: false` and the sender's id is filtered
  // anyway, so nothing should appear no matter how much is typed.
  const composer = page.getByRole('textbox', { name: `Message ${name}` })
  await composer.pressSequentially('typing away here', { delay: 30 })

  await expect(page.getByText(/is typing|are typing/)).toHaveCount(0)

  await deleteChannel(page, name)
})
