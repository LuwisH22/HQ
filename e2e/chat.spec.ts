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

/** The panel's collapse control, which is a sheet toggle on a phone. */
function panelToggle(page: Page) {
  return page.getByRole('button', { name: /(Open|Close) panel/ }).first()
}

test('opens the channel panel by default and collapses it on request', async ({
  page,
}, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)

  const panel = page.getByRole('complementary', { name: 'Channel details' })
  const isMobile = testInfo.project.name === 'mobile'

  if (isMobile) {
    // A phone has no room for a permanent second column, so the panel is a
    // sheet the same control opens.
    await expect(panel).toHaveCount(0)
    await panelToggle(page).click()
    await expect(page.getByRole('list', { name: 'Channel members' })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: 'Close panel' }).first().click()
    await expect(page.getByRole('list', { name: 'Channel members' })).toHaveCount(0)
  } else {
    // Open on arrival: a panel nobody knows to look for may as well not exist.
    await expect(panel).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close panel' })).toBeVisible()

    await panelToggle(page).click()
    await expect(panel).toBeHidden()
    await expect(page.getByRole('button', { name: 'Open panel' })).toBeVisible()

    await panelToggle(page).click()
    await expect(panel).toBeVisible()
  }

  // The member count moved into the panel; it is not the header control.
  await expect(page.getByRole('button', { name: /members/i })).toHaveCount(0)

  await deleteChannel(page, name)
})

test('widens the conversation when the panel closes, without stranding it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'The panel is a sheet on phones, not a column.')

  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)

  const composer = page.getByRole('textbox', { name: `Message ${name}` })
  const openBox = await composer.boundingBox()

  await panelToggle(page).click()
  await expect(page.getByRole('button', { name: 'Open panel' })).toBeVisible()
  // Past the 240ms transition.
  await page.waitForTimeout(600)

  const closedBox = await composer.boundingBox()
  expect(openBox).not.toBeNull()
  expect(closedBox).not.toBeNull()

  // The conversation gets the space the panel gave up...
  expect(closedBox!.width).toBeGreaterThan(openBox!.width)

  // ...and stays centred rather than sliding to the far-left edge. Measured
  // against the chat area, not the viewport: the sidebar occupies the first
  // 256px of the window and is not space the conversation was ever offered.
  const area = (await page.getByRole('main').boundingBox())!
  const leftGap = closedBox!.x - area.x
  const rightGap = area.x + area.width - (closedBox!.x + closedBox!.width)
  expect(Math.abs(leftGap - rightGap)).toBeLessThan(2)
  // And it is not flush against anything.
  expect(leftGap).toBeGreaterThan(8)

  await panelToggle(page).click()
  await deleteChannel(page, name)
})

test('names the channel and its members inside the panel', async ({ page }, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)

  if (testInfo.project.name === 'mobile') await panelToggle(page).click()

  const roster = page.getByRole('list', { name: 'Channel members' })
  await expect(roster).toBeVisible({ timeout: 15_000 })
  await expect(roster.getByRole('listitem').first()).toBeVisible()

  // The sections future work plugs into are present and honest about being
  // empty rather than absent.
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expect(page.getByText('No active voice session.')).toBeVisible()
  await expect(page.getByText('No active stream.')).toBeVisible()

  await deleteChannel(page, name)
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
