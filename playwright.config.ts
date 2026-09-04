import { readFileSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * Credentials for the signed-in specs come from a git-ignored `.env.e2e`
 * (matched by the `.env.*` rule), so a password never has to be typed into a
 * command line or pasted into a chat. Real environment variables still win.
 *
 *   E2E_EMAIL=you@example.com
 *   E2E_PASSWORD=...
 */
for (const line of (() => {
  try {
    return readFileSync('.env.e2e', 'utf8').split(/\r?\n/)
  } catch {
    return []
  }
})()) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq === -1) continue
  const name = trimmed.slice(0, eq).trim()
  if (!process.env[name]) process.env[name] = trimmed.slice(eq + 1).trim()
}

const SIGNOUT = /signout\.spec\.ts$/
// The organization has exactly one non-owner member, so moderation mutates a
// row every other signed-in spec can see. It therefore runs alone, after the
// rest, rather than racing them.
const MODERATION = /moderation\.spec\.ts$/
const PORT = 1420
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    colorScheme: 'dark',
  },
  // Playwright normally downloads its own browsers. On a machine where that
  // download is blocked, set PW_CHANNEL=chrome (or msedge) to drive an already
  // installed one instead.
  projects: [
    // Signs in once; the signed-in specs reuse the session it saves.
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts$/,
      use: { ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
    },
    {
      name: 'desktop',
      dependencies: ['setup'],
      testIgnore: [SIGNOUT, MODERATION],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
    {
      name: 'mobile',
      dependencies: ['setup'],
      testIgnore: [SIGNOUT, MODERATION],
      use: {
        ...devices['Pixel 7'],
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
    {
      name: 'moderation',
      testMatch: MODERATION,
      // Runs after the read-only specs: suspending or banning the only other
      // member changes what those specs would see.
      dependencies: ['desktop', 'mobile'],
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
    {
      name: 'signout',
      testMatch: SIGNOUT,
      // Runs last: signing out revokes every session for the user, including
      // the one the other projects share.
      dependencies: ['desktop', 'mobile', 'moderation'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
