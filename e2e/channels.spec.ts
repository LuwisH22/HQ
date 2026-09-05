import { expect, test } from '@playwright/test'
import {
  createCategory,
  createChannel,
  deleteCategory,
  deleteChannel,
  gotoChannelSettings,
  main,
  openNav,
  uniqueName,
} from './channel-helpers'

/**
 * Phase 1.5 · B3 — channels through the real UI.
 *
 * Names are unique per project and per run: the desktop and mobile projects
 * execute concurrently against the same live organization, and a shared
 * literal name makes them delete each other's channels. Everything created
 * here is removed again.
 */

test.use({ storageState: '.auth/owner.json' })

test('creates a channel from the sidebar, archives it, restores it, then deletes it', async ({
  page,
}, testInfo) => {
  const name = uniqueName('probe', testInfo.project.name)

  await page.goto('/#/')
  await createChannel(page, name)

  await gotoChannelSettings(page)
  // Archive is the reversible operation, and it is the one offered first.
  await page.getByRole('button', { name: `Archive ${name}` }).click()
  await expect(main(page).getByText('Archived')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: `Restore ${name}` }).click()
  await expect(page.getByRole('button', { name: `Archive ${name}` })).toBeVisible({
    timeout: 15_000,
  })

  await deleteChannel(page, name)
})

test('a private channel is marked as private and reachable from the directory', async ({
  page,
}, testInfo) => {
  const name = uniqueName('secret', testInfo.project.name)

  await page.goto('/#/')
  await createChannel(page, name, { visibility: 'Private' })

  // The owner sees it, because ownership is a column and not a role.
  await page.goto('/#/channels')
  await expect(page.getByRole('heading', { name: 'Channels', level: 1 })).toBeVisible()
  await expect(main(page).getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 })

  await deleteChannel(page, name)
})

test('offers Allow, Inherit and Deny for each overridable permission', async ({
  page,
}, testInfo) => {
  const name = uniqueName('perms', testInfo.project.name)

  await page.goto('/#/')
  await createChannel(page, name, { visibility: 'Private' })

  await gotoChannelSettings(page)
  await page
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Permissions' })
    .click()

  await expect(page.getByRole('heading', { name: `Permissions · ${name}` })).toBeVisible()

  // Only the safe subset is offered — a channel does not hand out ownership.
  await expect(page.getByText('View channel').first()).toBeVisible()
  await expect(page.getByText('Send messages').first()).toBeVisible()
  await expect(page.getByText('Delete organization')).toHaveCount(0)
  await expect(page.getByText('Ban members')).toHaveCount(0)

  const group = page.getByRole('group').first()
  await expect(group.getByRole('button', { name: 'Allow' })).toBeVisible()
  await expect(group.getByRole('button', { name: 'Inherit' })).toBeVisible()
  await expect(group.getByRole('button', { name: 'Deny' })).toBeVisible()

  await page.getByRole('button', { name: 'Done' }).click()
  await deleteChannel(page, name)
})

test('creates a category and its first channel in one action', async ({ page }, testInfo) => {
  const category = uniqueName('section', testInfo.project.name)
  const channel = uniqueName('inside', testInfo.project.name)

  await page.goto('/#/')
  await createChannel(page, channel, { newCategory: category })

  // The point of the flow: the channel is under the category just named, in
  // the sidebar, without a reload or a trip to Settings.
  await openNav(page)
  await expect(page.getByRole('button', { name: new RegExp(`^${category}`) })).toBeVisible()

  // A second channel picks the same category from the list, and must not make
  // a duplicate of it.
  const second = uniqueName('alongside', testInfo.project.name)
  await createChannel(page, second, { category })

  await gotoChannelSettings(page)
  await expect(page.getByRole('heading', { name: category, exact: true })).toHaveCount(1)
  await expect(
    page.getByRole('list', { name: `${category} channels` }).getByRole('listitem'),
  ).toHaveCount(2)

  await deleteChannel(page, channel)
  await deleteChannel(page, second)
  await deleteCategory(page, category)
})

test('creates an empty category from the sidebar and refuses a duplicate', async ({
  page,
}, testInfo) => {
  const category = uniqueName('reuse', testInfo.project.name)

  await page.goto('/#/')
  await createCategory(page, category)

  // It appears in the sidebar immediately, empty, with no navigation.
  await openNav(page)
  await expect(page.getByRole('button', { name: new RegExp(`^${category}`) })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page).toHaveURL(/#\/$/)

  // Naming it again is refused rather than making a second one.
  await openNav(page)
  await page.getByRole('button', { name: 'Create channel or category' }).click()
  await page.getByRole('menuitem', { name: 'Create category' }).click()
  await page.getByLabel('Category name').fill(category)
  await expect(page.getByText('A category with that name already exists.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'Create category' })).toHaveCount(0)

  await deleteCategory(page, category)
})

test('no longer offers a creation form in settings', async ({ page }) => {
  await gotoChannelSettings(page)

  // Creation moved to the sidebar; settings is for editing what exists.
  await expect(page.getByRole('heading', { name: 'Add' })).toHaveCount(0)
  await expect(page.getByLabel('New channel name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Public channel' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Category only' })).toHaveCount(0)
})
