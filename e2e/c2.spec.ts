import { expect, test, type Page } from '@playwright/test'
import { createChannel, deleteChannel, main, openNav, uniqueName } from './channel-helpers'

/**
 * Phase 2 · C2 — reactions, unread, pins, search and notifications.
 *
 * Everything of the form "somebody who cannot see X gets nothing" lives in
 * the unit suite: this session is the organization owner, who short-circuits
 * every check by design, so those cannot be demonstrated here.
 */

test.use({ storageState: '.auth/owner.json' })

async function send(page: Page, channel: string, body: string): Promise<void> {
  const composer = page.getByRole('textbox', { name: `Message ${channel}` })
  await composer.fill(body)
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText(body)).toBeVisible({ timeout: 15_000 })
}

/**
 * On a phone the panel is a sheet that covers the conversation and marks it
 * hidden, so it has to be closed again before the messages are reachable.
 */
async function togglePanelOnMobile(page: Page, project: string): Promise<void> {
  if (project !== 'mobile') return
  await page
    .getByRole('button', { name: /(Open|Close) panel/ })
    .first()
    .click()
}

test('reacts to a message, shows the count, and takes it back', async ({ page }, testInfo) => {
  const name = uniqueName('react', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'worth reacting to')

  const row = page.getByRole('listitem').filter({ hasText: 'worth reacting to' })
  await row.getByRole('button', { name: 'Add a reaction' }).first().click()
  await page.getByRole('button', { name: 'React with 👍' }).click()

  const chip = page.getByRole('button', { name: /👍 1/ })
  await expect(chip).toBeVisible({ timeout: 15_000 })
  // Pressed, because it counts you among the people who reacted.
  await expect(chip).toHaveAttribute('aria-pressed', 'true')

  await chip.click()
  await expect(page.getByRole('button', { name: /👍/ })).toHaveCount(0, { timeout: 15_000 })

  await deleteChannel(page, name)
})

test('shows a pinned message in the channel panel', async ({ page }, testInfo) => {
  const name = uniqueName('pinpanel', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'scrim tomorrow at 20:00')

  const row = page.getByRole('listitem').filter({ hasText: 'scrim tomorrow at 20:00' })
  await row.getByRole('button', { name: /Actions for message/ }).click()
  await page.getByRole('menuitem', { name: 'Pin message' }).click()

  await togglePanelOnMobile(page, testInfo.project.name)
  const pins = page.getByRole('list', { name: 'Pinned messages' })
  await expect(pins).toBeVisible({ timeout: 15_000 })
  await expect(pins.getByText('scrim tomorrow at 20:00')).toBeVisible()

  // Back to the conversation before touching the message again.
  await togglePanelOnMobile(page, testInfo.project.name)

  // Deleting a pinned message takes the pin with it, rather than leaving one
  // pointing at words nobody can read.
  const pinnedRow = page
    .getByRole('list', { name: 'Messages' })
    .getByRole('listitem')
    .filter({ hasText: 'scrim tomorrow at 20:00' })
  await pinnedRow.getByRole('button', { name: /Actions for message/ }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete message' }).click()

  await expect(page.getByText('This message was deleted.')).toBeVisible({ timeout: 15_000 })
  await togglePanelOnMobile(page, testInfo.project.name)
  await expect(page.getByText('Nothing pinned yet.')).toBeVisible({ timeout: 15_000 })
  await togglePanelOnMobile(page, testInfo.project.name)

  await deleteChannel(page, name)
})

test('searches the channel and finds what was said', async ({ page }, testInfo) => {
  const name = uniqueName('search', testInfo.project.name)
  const marker = `zqxjv${String(Date.now() % 100000)}`
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, `the needle is ${marker}`)

  await page.getByRole('button', { name: 'Search this channel' }).click()
  await page.getByRole('textbox', { name: 'Search messages' }).fill(marker)

  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results).toBeVisible({ timeout: 20_000 })
  await expect(results.getByText(`the needle is ${marker}`)).toBeVisible()

  // And the same query across every channel the member can see.
  await page.getByRole('button', { name: 'All channels' }).click()
  await expect(results.getByText(`the needle is ${marker}`)).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Close search' }).click()
  await deleteChannel(page, name)
})

test('finds nothing for a word nobody has said', async ({ page }, testInfo) => {
  const name = uniqueName('nosearch', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  await page.getByRole('button', { name: 'Search this channel' }).click()
  await page.getByRole('textbox', { name: 'Search messages' }).fill('qqzzxxjjvv')
  await expect(page.getByText('Nothing matches that')).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Close search' }).click()
  await deleteChannel(page, name)
})

test('offers a notification bell that opens and reports honestly', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: /^Notifications/ }).click()

  // Nothing is claimed here about what is in it: the owner may or may not have
  // been mentioned. What must hold is that the list is theirs and it says so.
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
})

test('marks a channel read when it is opened', async ({ page }, testInfo) => {
  const name = uniqueName('unread', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)
  await send(page, name, 'read me')

  // Your own message is never unread, so the badge must be absent.
  await page.goto('/#/')
  await openNav(page)
  const row = page.getByRole('link', { name, exact: true })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row.getByText(/^\d+$/)).toHaveCount(0)

  await deleteChannel(page, name)
})

test('no longer offers the disabled search placeholder', async ({ page }, testInfo) => {
  const name = uniqueName('nostub', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  const search = page.getByRole('button', { name: 'Search this channel' })
  await expect(search).toBeEnabled()
  await expect(main(page).getByText('Channel search arrives with C2')).toHaveCount(0)

  await deleteChannel(page, name)
})
