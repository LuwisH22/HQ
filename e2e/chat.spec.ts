import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 2 · C1 — chat through the real UI.
 *
 * Each run works in its own channel, created and deleted here: the desktop and
 * mobile projects run concurrently against the same organization, and sharing
 * a channel would mean asserting on each other's messages.
 */

test.use({ storageState: '.auth/owner.json' })

function uniqueName(project: string): string {
  return `chat-${project}-${String(Date.now() % 100000)}`
}

async function createChannel(page: Page, name: string): Promise<void> {
  await page.goto('/#/settings/channels')
  await expect(page.getByRole('heading', { name: 'Add' })).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('New category name').fill('')
  await page.getByRole('textbox', { name: 'New channel name' }).fill(name)
  await page.getByRole('button', { name: 'Public channel', exact: true }).click()
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 })
}

async function deleteChannel(page: Page, name: string): Promise<void> {
  await page.goto('/#/settings/channels')
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: `Delete ${name}` }).click()
  await expect(page.getByText(name, { exact: true })).toHaveCount(0, { timeout: 15_000 })
}

async function openChannel(page: Page, name: string): Promise<void> {
  await page.goto('/#/channels')
  await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('link').filter({ hasText: name }).first().click()
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 })
}

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
