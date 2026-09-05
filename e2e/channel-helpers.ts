import { expect, type Page } from '@playwright/test'

/**
 * Creating and removing channels through the interface, shared by the specs
 * that need one to exist before they can test something else.
 *
 * Creation is the sidebar's `+` (the drawer's, on a phone). Removal is still
 * Settings, which is where the administration lives — so these two helpers
 * deliberately go to different places.
 */

/** The page itself, excluding the sidebar and the drawer around it. */
export function main(page: Page) {
  return page.getByRole('main')
}

/** Names are unique per project and per run: the projects execute together. */
export function uniqueName(prefix: string, project: string): string {
  return `${prefix}-${project}-${String(Date.now() % 100000)}`
}

/**
 * Open the channel list, which is a drawer on phones and always-on elsewhere.
 *
 * Keyed off the viewport rather than off whether the opener happens to be
 * visible yet: asking a page that has not finished loading gets `false`, the
 * drawer never opens, and the failure lands on whatever is looked for next.
 */
export async function openNav(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1280
  if (width >= 768) return

  const closer = page.locator('button[aria-label="Close navigation"]')
  if ((await closer.count()) > 0) return

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(closer).toHaveCount(1, { timeout: 20_000 })
}

async function openCreateMenu(page: Page): Promise<void> {
  await openNav(page)
  await page.getByRole('button', { name: 'Create channel or category' }).click()
}

/**
 * Close the phone drawer if it is open. Harmless on desktop.
 *
 * Matched through the DOM rather than by role: a dialog opened from inside the
 * drawer marks the drawer `aria-hidden` while it closes, and a role-based
 * probe reports the drawer as absent for exactly as long as that lasts.
 */
export async function closeNav(page: Page): Promise<void> {
  const closer = page.locator('button[aria-label="Close navigation"]')
  if ((await closer.count()) === 0) return
  await closer.click()
  await expect(closer).toHaveCount(0, { timeout: 10_000 })
}

export interface CreateChannelOptions {
  visibility?: 'Public' | 'Private'
  /** Pick a category that already exists, by name. */
  category?: string
  /** Name a category that does not exist yet; it is created with the channel. */
  newCategory?: string
}

/**
 * Create a channel and land in it.
 *
 * Asserting on the conversation heading proves two things at once: the
 * channel exists, and creating it opened it.
 */
export async function createChannel(
  page: Page,
  name: string,
  options: CreateChannelOptions = {},
): Promise<void> {
  await openCreateMenu(page)
  await page.getByRole('menuitem', { name: 'Create channel' }).click()
  await expect(page.getByRole('heading', { name: 'Create channel' })).toBeVisible()

  await page.getByLabel('Channel name').fill(name)

  if (options.category ?? options.newCategory) {
    await page.getByRole('combobox', { name: 'Category' }).click()
    await page
      .getByRole('option', {
        name: options.newCategory ? /New category/ : options.category,
        exact: !options.newCategory,
      })
      .click()
    if (options.newCategory) {
      await page.getByLabel('New category name').fill(options.newCategory)
    }
  }

  if (options.visibility === 'Private') {
    await page.getByRole('button', { name: 'Private', exact: true }).click()
  }

  await page.getByRole('button', { name: 'Create', exact: true }).click()

  // Creating a channel opens it — no trip back through a directory.
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 })
}

export async function createCategory(page: Page, name: string): Promise<void> {
  await openCreateMenu(page)
  await page.getByRole('menuitem', { name: 'Create category' }).click()
  await expect(page.getByRole('heading', { name: 'Create category' })).toBeVisible()

  await page.getByLabel('Category name').fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Create category' })).toHaveCount(0, {
    timeout: 15_000,
  })
}

export async function gotoChannelSettings(page: Page): Promise<void> {
  // A hash change does not reload the document, so a drawer left open stays
  // open — and it marks the page behind it hidden, which makes everything
  // below unfindable rather than merely covered.
  await closeNav(page)
  await page.goto('/#/settings/channels')
  await expect(page.getByRole('heading', { name: 'Channels', level: 2 })).toBeVisible({
    timeout: 20_000,
  })
}

export async function deleteChannel(page: Page, name: string): Promise<void> {
  await gotoChannelSettings(page)
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click()
  await expect(main(page).getByText(name, { exact: true })).toHaveCount(0, { timeout: 15_000 })
}

export async function deleteCategory(page: Page, name: string): Promise<void> {
  await gotoChannelSettings(page)
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: `Delete category ${name}` }).click()
  await expect(main(page).getByText(name, { exact: true })).toHaveCount(0, { timeout: 15_000 })
}
