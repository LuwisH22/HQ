import { expect, test as setup } from '@playwright/test'

/**
 * Signs in once and saves the session for the signed-in specs to reuse.
 *
 * Previously every spec signed in through `beforeEach`. Against the local
 * stack that was merely wasteful; against a hosted Supabase project it means
 * ~70 password grants in ninety seconds, which trips the auth rate limit and
 * fails whichever specs happen to run last. Reusing one session removes the
 * redundant grants entirely.
 *
 * The saved file holds a live access token, so it is git-ignored (`.auth/`).
 */

const STORAGE_STATE = '.auth/owner.json'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

setup('authenticate', async ({ page }) => {
  setup.skip(!email || !password, 'No credentials in .env.e2e — signed-in specs will skip.')

  await page.goto('/#/auth/sign-in')
  await page.getByLabel('Email').fill(email as string)
  await page.getByLabel('Password').fill(password as string)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Still up/ }),
  ).toBeVisible({ timeout: 20_000 })

  await page.context().storageState({ path: STORAGE_STATE })
})
