import { expect, test, type Page } from '@playwright/test'

/**
 * Demo mode end to end.
 *
 * These need no Supabase project, which is the whole point: they are the only
 * specs that exercise the signed-in application without a backend. They run
 * against the dev server, where demo mode is available.
 *
 * Each test starts from a clean store so ordering never matters.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/#/auth/sign-in')
  await page.evaluate(() => {
    window.localStorage.removeItem('lfg-hq-demo-db')
    window.localStorage.removeItem('lfg-hq-demo-session')
  })
  await page.goto('/#/auth/sign-in')
})

async function enterDemo(page: Page) {
  await page.getByRole('button', { name: 'Continue as Demo Admin' }).click()
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Still up/ }),
  ).toBeVisible({ timeout: 15_000 })
}

test('signs in without any credentials and labels the session as demo', async ({ page }) => {
  await enterDemo(page)
  await expect(page.getByRole('status').filter({ hasText: 'Demo mode' })).toBeVisible()
})

test('shows real seeded data on the dashboard', async ({ page }) => {
  await enterDemo(page)
  await expect(page.getByText('Active members')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Team status' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible()
})

test('changes a member role and keeps it after a reload', async ({ page }) => {
  await enterDemo(page)
  await page.goto('/#/members')
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()

  const row = page.getByRole('listitem').filter({ hasText: 'noorx' })
  await row.getByRole('button', { name: /Actions for/ }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Coach' }).click()

  await expect(row.getByText('Coach')).toBeVisible()

  await page.reload()
  await expect(
    page.getByRole('listitem').filter({ hasText: 'noorx' }).getByText('Coach'),
  ).toBeVisible()
})

test('creates an invitation and lists it as pending', async ({ page }) => {
  await enterDemo(page)
  await page.goto('/#/members?invite=1')

  await page.getByLabel('Email address').fill('e2e.recruit@lfg.test')
  await page.getByRole('button', { name: 'Send invitation' }).click()

  await expect(page.getByText('e2e.recruit@lfg.test')).toBeVisible()
})

test('offers no self-management actions on your own row', async ({ page }) => {
  await enterDemo(page)
  await page.goto('/#/members')

  // Your own row offers no actions menu. Ownership itself is protected by
  // organizations.owner_id, not by anything on this screen.
  const ownRow = page.getByRole('listitem').filter({ hasText: 'demo.owner@lfg.test' })
  await expect(ownRow).toHaveCount(1)
  await expect(ownRow.getByText('You', { exact: true })).toBeVisible()
  await expect(ownRow.getByRole('button', { name: /Actions for/ })).toHaveCount(0)
})

test('saves a profile change without clearing the timezone', async ({ page }) => {
  await enterDemo(page)
  await page.goto('/#/settings/profile')

  const timezone = page.getByRole('combobox', { name: /timezone/i })
  await expect(timezone).toHaveText('Europe/Berlin')

  await page.getByLabel('Title').fill('Interim Head of Ops')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Profile updated.')).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('Title')).toHaveValue('Interim Head of Ops')
  await expect(page.getByRole('combobox', { name: /timezone/i })).toHaveText('Europe/Berlin')
})

test('renders the permission matrix', async ({ page }) => {
  await enterDemo(page)
  await page.goto('/#/settings/roles')

  await expect(page.getByRole('heading', { name: 'Permission matrix' })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
})

test('signing out of demo mode returns to sign-in', async ({ page }) => {
  await enterDemo(page)

  // On phones the sidebar is replaced by a drawer, so the account menu lives
  // behind it rather than being on screen.
  const openNav = page.getByRole('button', { name: 'Open navigation' })
  if (await openNav.isVisible()) await openNav.click()

  await page.getByRole('button', { name: 'Account menu' }).first().click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()

  await expect(page.getByRole('button', { name: 'Continue as Demo Admin' })).toBeVisible()
})
