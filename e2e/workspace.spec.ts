import { expect, test, type Page } from '@playwright/test'

/**
 * Signed-in workspace coverage.
 *
 * Requires a Supabase project reachable from `.env` and a seeded account.
 * Run against the local stack:
 *
 *   npx supabase start && npx supabase db reset
 *   npm run e2e
 *
 * Credentials are read from a git-ignored `.env.e2e` (see playwright.config.ts):
 *
 *   E2E_EMAIL=...
 *   E2E_PASSWORD=...
 *
 * For the local stack these are the seeded owner account — see
 * `supabase/seed/seed.sql`, which is the single source of truth for them.
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

/** On phones the sidebar and account menu live behind the navigation drawer. */
async function openNavIfMobile(page: Page) {
  const openNav = page.getByRole('button', { name: 'Open navigation' })
  if (await openNav.isVisible()) await openNav.click()
}

/**
 * Open the profile dialog from the sidebar footer.
 *
 * Keyed off the viewport rather than off whether the opener happens to be
 * visible yet: asking a page that has not finished loading gets `false`, the
 * drawer never opens, and the failure lands somewhere else entirely.
 */
async function openProfile(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole('button', { name: 'Open navigation' }).click()
  }
  await page.getByRole('button', { name: 'Your profile' }).first().click()
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible({
    timeout: 15_000,
  })
}

// One shared session, established by e2e/auth.setup.ts. Signing in per test
// would issue a password grant per spec and trip the hosted auth rate limit.
test.use({ storageState: '.auth/owner.json' })

test.beforeEach(async ({ page }) => {
  await page.goto('/#/')
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Still up/ }),
  ).toBeVisible({ timeout: 20_000 })
})

test.describe('workspace shell', () => {
  test('lands on the dashboard with real organization data', async ({ page }) => {
    const ribbon = page.getByRole('region', { name: 'Organization at a glance' })
    await expect(ribbon.getByText('Active', { exact: true })).toBeVisible()
    await expect(ribbon.getByText('Your role', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Team status' })).toBeVisible()
  })

  test('navigates between sections without a full reload', async ({ page }) => {
    await openNavIfMobile(page)
    await page.getByRole('link', { name: 'Members', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()

    await openNavIfMobile(page)
    await page.getByRole('link', { name: 'Settings', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('opens the command palette with the keyboard and jumps to a section', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('listbox', { name: 'Results' })).toBeVisible()
    await expect(page.getByLabel('Search', { exact: true })).toBeFocused()

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

  test('collapses and restores the sidebar', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'The sidebar is replaced by a drawer on phones.')
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
    const roster = page.getByRole('list', { name: 'Members' })
    await expect(roster.getByRole('listitem').first()).toBeVisible()

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

test.describe('profile', () => {
  test('opens from the sidebar, saves, and never leaves the page', async ({ page }) => {
    const url = page.url()

    await openProfile(page)
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible()
    // A quick overlay, not a destination: the address bar does not move.
    await expect(page).toHaveURL(url)

    // A dashboard-created account starts with display_name NULL and the form
    // requires it, so fill it before expecting a save to go through.
    const displayName = page.getByLabel('Display name')
    if ((await displayName.inputValue()) === '') await displayName.fill('qa-owner')

    const title = page.getByLabel('Title')
    const next = `QA ${Date.now() % 10_000}`
    await title.fill(next)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Profile updated.')).toBeVisible()

    await page.reload()
    await openProfile(page)
    await expect(page.getByLabel('Title')).toHaveValue(next)
  })

  test('offers a distinct log out control with its own label', async ({ page }) => {
    await openNavIfMobile(page)
    const logout = page.getByRole('button', { name: 'Log out' }).first()
    await expect(logout).toBeVisible()
    // Signing out and collapsing the sidebar are different things, and the
    // arrow that does the second used to be the only control down there.
    await expect(logout).not.toHaveAttribute('aria-expanded', /.*/)
  })
})

test.describe('settings', () => {
  test('holds organization configuration and no personal profile', async ({ page }) => {
    await page.goto('/#/settings')

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // Scoped to the settings tabs: the phone's bottom bar has a Channels link
    // of its own, and it is not what this is about.
    const tabs = page.getByRole('navigation', { name: 'Settings sections' })
    await expect(tabs.getByRole('link', { name: 'Your profile' })).toHaveCount(0)
    await expect(tabs.getByRole('link', { name: 'Organization' })).toBeVisible()
    await expect(tabs.getByRole('link', { name: 'Roles & permissions' })).toBeVisible()
    await expect(tabs.getByRole('link', { name: 'Channels' })).toBeVisible()
  })

  test('sends the retired profile link back to Settings', async ({ page }) => {
    await page.goto('/#/settings/profile')

    // Through the index, which picks the first section this member may open —
    // so an old bookmark lands somewhere real instead of on a not-found page.
    await expect(page).toHaveURL(/#\/settings\/organization$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // And it is a redirect, not a second profile form kept alive in a corner.
    await expect(page.getByLabel('Display name')).toHaveCount(0)
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
