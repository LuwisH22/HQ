import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 1.5 · B3 — channels through the real UI.
 *
 * Names are unique per project and per run: the desktop and mobile projects
 * execute concurrently against the same live organization, and a shared
 * literal name makes them delete each other's channels. Everything created
 * here is removed again.
 */

test.use({ storageState: '.auth/owner.json' })

/** The page itself, excluding the sidebar and the drawer around it. */
function main(page: Page) {
  return page.getByRole('main')
}

function uniqueName(prefix: string, project: string): string {
  return `${prefix}-${project}-${String(Date.now() % 100000)}`
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings/channels')
  await expect(page.getByRole('heading', { name: 'Add' })).toBeVisible({ timeout: 20_000 })
})

async function createChannel(
  page: Page,
  name: string,
  visibility: 'Public' | 'Private',
  category?: string,
) {
  // Left empty, the channel is uncategorised — which is what most of these
  // specs want, and what the section says it will do.
  await page.getByLabel('New category name').fill(category ?? '')
  await page.getByRole('textbox', { name: 'New channel name' }).fill(name)
  await page.getByRole('button', { name: `${visibility} channel`, exact: true }).click()
  await expect(main(page).getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 })
}

async function deleteChannel(page: Page, name: string) {
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: `Delete ${name}` }).click()
  await expect(main(page).getByText(name, { exact: true })).toHaveCount(0, { timeout: 15_000 })
}

test('creates a channel, archives it, restores it, then deletes it', async ({ page }, testInfo) => {
  const name = uniqueName('probe', testInfo.project.name)

  await createChannel(page, name, 'Public')

  // Archive is the reversible operation, and it is the one offered first.
  await page.getByRole('button', { name: `Archive ${name}` }).click()
  await expect(page.getByText('Archived')).toBeVisible({ timeout: 15_000 })

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

  await createChannel(page, name, 'Private')

  // The owner sees it, because ownership is a column and not a role.
  await page.goto('/#/channels')
  await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible()
  await expect(main(page).getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 })

  await page.goto('/#/settings/channels')
  await deleteChannel(page, name)
})

test('offers Allow, Inherit and Deny for each overridable permission', async ({
  page,
}, testInfo) => {
  const name = uniqueName('perms', testInfo.project.name)

  await createChannel(page, name, 'Private')

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

  await createChannel(page, channel, 'Public', category)

  // The point of the change: the channel is under the category just typed,
  // not sitting in Uncategorised beneath it.
  await expect(
    page.getByRole('list', { name: `${category} channels` }).getByText(channel, { exact: true }),
  ).toBeVisible({ timeout: 15_000 })

  // A second channel names the same category and must not make a duplicate.
  const second = uniqueName('alongside', testInfo.project.name)
  await createChannel(page, second, 'Private', category.toUpperCase())
  await expect(page.getByRole('heading', { name: category, exact: true })).toHaveCount(1)
  await expect(
    page.getByRole('list', { name: `${category} channels` }).getByRole('listitem'),
  ).toHaveCount(2)

  await deleteChannel(page, channel)
  await deleteChannel(page, second)
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: `Delete category ${category}` }).click()
  await expect(main(page).getByText(category, { exact: true })).toHaveCount(0, { timeout: 15_000 })
})

test('names an existing category before it is used, and offers no duplicate', async ({
  page,
}, testInfo) => {
  const category = uniqueName('reuse', testInfo.project.name)

  await page.getByLabel('New category name').fill(category)
  await page.getByRole('button', { name: 'Category only' }).click()
  await expect(page.getByRole('heading', { name: category, exact: true })).toBeVisible({
    timeout: 15_000,
  })

  // Typing it again recognises it, and the category-only button steps aside
  // rather than offering to make a second one.
  await page.getByLabel('New category name').fill(category)
  await expect(page.getByText(`${category} already exists.`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Category only' })).toBeDisabled()

  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: `Delete category ${category}` }).click()
  await expect(main(page).getByText(category, { exact: true })).toHaveCount(0, { timeout: 15_000 })
})
