import { expect, test } from '@playwright/test'

/**
 * Sign-out, deliberately isolated from the rest of the signed-in suite.
 *
 * `supabase.auth.signOut()` defaults to `scope: 'global'`, which revokes every
 * refresh token the user holds — not just this browser's. That is the safer
 * default for a private workspace (losing a laptop signs it out everywhere),
 * so the app keeps it.
 *
 * The consequence for testing is that this spec cannot share the session the
 * other specs reuse: signing out here would invalidate their session mid-run.
 * So it establishes its own session, and `playwright.config.ts` puts it in a
 * project that depends on the others, making it run last.
 */

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD in .env.e2e.')

test('signing out returns to the sign-in screen and blocks the app', async ({ page }) => {
  await page.goto('/#/auth/sign-in')
  await page.getByLabel('Email').fill(email as string)
  await page.getByLabel('Password').fill(password as string)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Still up/ }),
  ).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Account menu' }).first().click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  // The guard must hold on a direct navigation too, not just in the UI.
  await page.goto('/#/members')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
