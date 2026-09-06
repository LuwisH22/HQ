import { expect, test, type Page } from '@playwright/test'
import { createChannel, deleteChannel, uniqueName } from './channel-helpers'

/**
 * Phase 4 · Voice — Step 1, through the real interface.
 *
 * The foundation, not the product: a voice channel is a channel, it opens a
 * voice surface rather than a chat one, and asking to join reaches the server
 * and comes back with an answer. Who is allowed in is proved in the unit
 * suite and against the live database — this session is the organization's
 * owner, who passes every check by design.
 *
 * Deliberately silent about whether the connection succeeds. That depends on
 * whether LiveKit is configured for this project, and a test that asserted
 * either way would be wrong in one of the two worlds. What it does assert is
 * that the client asks and settles: a request that never leaves, or a state
 * that never resolves, fails here.
 */

test.use({ storageState: '.auth/owner.json' })

const panel = (page: Page, name: string) => page.getByRole('group', { name: `Voice in ${name}` })
const status = (page: Page) => page.locator('[data-voice-status]')

test('makes a voice channel and opens a voice surface, not a chat one', async ({
  page,
}, testInfo) => {
  const name = uniqueName('voice', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })

  // The heading is the channel, the same as any other.
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 })

  // What is absent is the point: a voice channel is not a place for messages.
  await expect(page.getByRole('textbox', { name: `Message ${name}` })).toHaveCount(0)
  // Exact: the sidebar's 'Direct messages' list would match a loose one.
  await expect(page.getByRole('list', { name: 'Messages', exact: true })).toHaveCount(0)

  await expect(panel(page, name)).toBeVisible()
  await expect(status(page)).toHaveAttribute('data-voice-status', 'idle')
  await expect(page.getByRole('button', { name: 'Join voice' })).toBeEnabled()
  // Not connected, so there is nothing to leave or mute yet.
  await expect(page.getByRole('button', { name: 'Leave voice' })).toHaveCount(0)

  await deleteChannel(page, name)
})

test('asks the server to join, and settles on an answer', async ({ page }, testInfo) => {
  const name = uniqueName('voice', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })

  await page.getByRole('button', { name: 'Join voice' }).click()

  // Whatever the answer, the client stops being idle: the request left.
  await expect(status(page)).not.toHaveAttribute('data-voice-status', 'idle', { timeout: 15_000 })

  // And it settles. Connected where LiveKit is configured, an error where it
  // is not — never stuck mid-flight.
  await expect
    .poll(async () => status(page).getAttribute('data-voice-status'), {
      timeout: 30_000,
      message: 'the connection never settled',
    })
    .toMatch(/^(connected|error)$/)

  const settled = await status(page).getAttribute('data-voice-status')
  if (settled === 'connected') {
    await expect(page.getByRole('button', { name: 'Leave voice' })).toBeVisible()
    await page.getByRole('button', { name: 'Leave voice' }).click()
    // Leaving actually leaves: back to where it started, ready to join again.
    await expect(status(page)).toHaveAttribute('data-voice-status', 'idle', { timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Join voice' })).toBeVisible()
  } else {
    // A refusal is a sentence, not a spinner.
    await expect(page.getByRole('status')).not.toBeEmpty()
  }

  await deleteChannel(page, name)
})

test('leaves text channels exactly as they were', async ({ page }, testInfo) => {
  const name = uniqueName('voicetext', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  // The default is still text, and a text channel is still a chat.
  await expect(page.getByRole('textbox', { name: `Message ${name}` })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
  await expect(page.getByRole('group', { name: /^Voice in / })).toHaveCount(0)

  await deleteChannel(page, name)
})

test('fits a narrow screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'about the phone layout')

  const name = uniqueName('voice', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })

  await expect(panel(page, name)).toBeVisible({ timeout: 20_000 })
  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflowing).toBe(false)

  await deleteChannel(page, name)
})
