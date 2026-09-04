import { expect, test, type Page } from '@playwright/test'

/**
 * Signed-in workspace coverage.
 *
 * Requires a Supabase project reachable from `.env` and a seeded account.
 * Run against the local stack:
 *
 *   npx supabase start && npx supabase db reset
 *   E2E_EMAIL=owner@lfg.test E2E_PASSWORD='LfgHq!Dev2025' npm run e2e
 *
 * Without those variables the whole file is skipped rather than failing, so a
 * contributor with no backend still gets a green run from `auth.spec.ts`.
 */

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

test.skip(
  !EMAIL || !PASSWORD,
  'Set E2E_EMAIL and E2E_PASSWORD to run the signed-in workspace specs.',
)

async function signIn(page: Page) {
  await page.goto('/#/auth/sign-in')
  await page.getByLabel('Email').fill(EMAIL as string)
  await page.getByLabel('Password').fill(PASSWORD as string)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Still up/ }),
  ).toBeVisible({ timeout: 15_000 })
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test.describe('workspace shell', () => {
  test('lands on the dashboard with real organization data', async ({ page }) => {
    await expect(page.getByText('Active members')).toBeVisible()
    await expect(page.getByText('Your role')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Team status' })).toBeVisible()
  })

  test('navigates between sections without a full reload', async ({ page }) => {
    await page.getByRole('link', { name: 'Members', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()

    await page.getByRole('link', { name: 'Settings', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('opens the command palette with the keyboard and jumps to a section', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k')
    const search = page.getByRole('combobox', { name: 'Search' }).or(page.getByLabel('Search'))
    await expect(search.first()).toBeFocused()

    await page.keyboard.type('memb')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
  })

  test('closes the command palette on Escape', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('listbox', { name: 'Results' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox', { name: 'Results' })).toHaveCount(0)
  })

  test('collapses and restores the sidebar', async ({ page }) => {
    const collapse = page.getByRole('button', { name: 'Collapse sidebar' })
    await collapse.click()
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    await page.getByRole('button', { name: 'Expand sidebar' }).click()
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
  })

  test('shows a not-found page for an unknown route', async ({ page }) => {
    await page.goto('/#/nowhere')
    await expect(page.getByText('This page does not exist')).toBeVisible()
  })
})

test.describe('members', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/members')
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
  })

  test('filters the roster from the search box', async ({ page }) => {
    const rows = page.getByRole('listitem')
    const before = await rows.count()
    expect(before).toBeGreaterThan(1)

    await page.getByLabel('Search members').fill('zzzz-no-such-person')
    await expect(page.getByText('No members match that search')).toBeVisible()

    await page.getByLabel('Search members').fill('')
    await expect(page.getByText('No members match that search')).toHaveCount(0)
  })

  test('offers no self-management menu on your own row', async ({ page }) => {
    const ownRow = page.getByRole('listitem').filter({ hasText: 'You' })
    await expect(ownRow).toHaveCount(1)
    await expect(ownRow.getByRole('button', { name: /Actions for/ })).toHaveCount(0)
  })

  test('opens and closes the invite dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Invite', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Invite a member' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('rejects an invalid invite address before sending', async ({ page }) => {
    await page.getByRole('button', { name: 'Invite', exact: true }).click()
    await page.getByLabel('Email address').fill('bad-address')
    await page.getByRole('button', { name: 'Send invitation' }).click()
    await expect(page.getByText('Enter a valid email address')).toBeVisible()
  })
})

test.describe('settings', () => {
  test('saves a profile change and persists it across a reload', async ({ page }) => {
    await page.goto('/#/settings/profile')

    const title = page.getByLabel('Title')
    const next = `QA ${Date.now() % 10_000}`
    await title.fill(next)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Profile updated.')).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Title')).toHaveValue(next)
  })

  test('shows the permission matrix', async ({ page }) => {
    await page.goto('/#/settings/roles')
    await expect(page.getByRole('heading', { name: 'Permission matrix' })).toBeVisible()
    await expect(page.getByRole('table')).toBeVisible()
  })

  test('keeps the immutable organization handle read-only', async ({ page }) => {
    await page.goto('/#/settings/organization')
    await expect(page.getByLabel('Handle')).toBeDisabled()
  })
})

test.describe('session', () => {
  test('signing out returns to the sign-in screen and blocks the app', async ({ page }) => {
    await page.getByRole('button', { name: 'Account menu' }).first().click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    await page.goto('/#/members')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })
})

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('shows the bottom tab bar instead of the sidebar', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    await expect(page.getByTestId('sidebar')).toBeHidden()
  })

  test('opens the navigation drawer', async ({ page }) => {
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(page.getByRole('navigation', { name: 'All sections' })).toBeVisible()
  })
})
