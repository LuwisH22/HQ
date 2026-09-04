import { expect, test } from '@playwright/test'

/**
 * Authentication end-to-end coverage.
 *
 * These run against the dev server with whatever Supabase project `.env`
 * points at. The specs below need no seeded data — they cover the guarded
 * boundary, which is exactly the part that must not regress.
 *
 * Specs that need a signed-in session live in `workspace.spec.ts` and skip
 * themselves unless E2E_EMAIL / E2E_PASSWORD are provided.
 */

/**
 * These specs exercise the real sign-in form, which only renders when Supabase
 * credentials are configured. With no `.env` the app shows "No backend
 * configured" and offers demo mode instead — a legitimate state, covered by
 * `demo-mode.spec.ts`. Skip rather than fail, so a checkout without credentials
 * still gets a green run.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/#/auth/sign-in')
  const noBackend = await page
    .getByRole('heading', { name: 'No backend configured' })
    .isVisible()
    .catch(() => false)
  test.skip(noBackend, 'No Supabase credentials configured; the sign-in form is not rendered.')
})

test.describe('unauthenticated access', () => {
  test('redirects the root route to sign-in', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('sends a deep link back to sign-in and remembers where it was headed', async ({ page }) => {
    await page.goto('/#/members')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    expect(page.url()).toContain('redirectTo')
  })

  test('offers no way to create an account', async ({ page }) => {
    await page.goto('/#/auth/sign-in')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    // LFG HQ is invitation-only. A registration affordance appearing here would
    // be a serious regression, so assert its absence explicitly.
    await expect(page.getByRole('link', { name: /sign up|create account|register/i })).toHaveCount(
      0,
    )
    await expect(
      page.getByRole('button', { name: /sign up|create account|register/i }),
    ).toHaveCount(0)
  })

  test('validates the email field before submitting', async ({ page }) => {
    await page.goto('/#/auth/sign-in')
    await page.getByLabel('Email').fill('not-an-email')
    await page.getByLabel('Password').fill('some-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('Enter a valid email address')).toBeVisible()
  })

  test('accepts an address with stray whitespace and casing', async ({ page }) => {
    await page.goto('/#/auth/sign-in')
    await page.getByLabel('Email').fill('  Owner@LFG.TEST  ')
    await page.getByLabel('Password').fill('some-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // The address is normalised, so the failure must be about credentials,
    // never about the format.
    await expect(page.getByText('Enter a valid email address')).toHaveCount(0)
  })

  test('can switch to the magic-link form and back', async ({ page }) => {
    await page.goto('/#/auth/sign-in')
    await page.getByRole('button', { name: /Email me a sign-in link/i }).click()
    await expect(page.getByRole('button', { name: 'Send sign-in link' })).toBeVisible()
    await expect(page.getByLabel('Password')).toHaveCount(0)

    await page.getByRole('button', { name: /Sign in with a password/i }).click()
    await expect(page.getByLabel('Password')).toBeVisible()
  })

  test('reaches the password reset form', async ({ page }) => {
    await page.goto('/#/auth/sign-in')
    await page.getByRole('link', { name: 'Forgot your password?' }).click()
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  })

  test('rejects an invite link with no token', async ({ page }) => {
    await page.goto('/#/auth/accept-invite')
    await expect(
      page.getByRole('heading', { name: 'We could not accept this invitation' }),
    ).toBeVisible()
    await expect(page.getByText(/missing its token/i)).toBeVisible()
  })
})

test.describe('accessibility basics', () => {
  test('the sign-in form is keyboard navigable and labelled', async ({ page }) => {
    await page.goto('/#/auth/sign-in')

    const email = page.getByLabel('Email')
    await email.focus()
    await expect(email).toBeFocused()

    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Password')).toBeFocused()

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused()
  })

  test('an invalid field is marked for assistive technology', async ({ page }) => {
    await page.goto('/#/auth/sign-in')
    await page.getByLabel('Email').fill('nope')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert').first()).toBeVisible()
  })
})
