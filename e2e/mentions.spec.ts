import { expect, test, type Page } from '@playwright/test'
import { createChannel, deleteChannel, uniqueName } from './channel-helpers'

/**
 * Phase 2 · C3 — mentions through the real UI.
 *
 * Two things are being proved here that a unit test cannot: that the menu
 * behaves like a menu under a real keyboard, and that what gets highlighted in
 * a sent message comes from the rows the database recorded rather than from
 * the composer re-parsing its own text hopefully.
 *
 * This session is the organization owner, who can see every channel by design,
 * so "somebody who cannot see the channel is not offered and not notified"
 * lives in the unit suite instead.
 */

test.use({ storageState: '.auth/owner.json' })

function composer(page: Page, channel: string) {
  return page.getByRole('textbox', { name: `Message ${channel}` })
}

const menu = (page: Page) => page.getByRole('listbox', { name: 'Mention a member' })

/** Type into the composer the way a person does, so the caret moves with it. */
async function type(page: Page, channel: string, text: string): Promise<void> {
  await composer(page, channel).click()
  await composer(page, channel).pressSequentially(text, { delay: 20 })
}

async function send(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Send' }).click()
}

/** The handles the channel actually offers, in the order the menu lists them. */
async function offeredHandles(page: Page, channel: string): Promise<string[]> {
  await type(page, channel, '@')
  await expect(menu(page)).toBeVisible({ timeout: 15_000 })

  const options = menu(page).getByRole('option')
  await expect(options.first()).toBeVisible()
  const handles = await options.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-handle') ?? ''),
  )

  await composer(page, channel).fill('')
  return handles
}

test('completes a mention from the keyboard', async ({ page }, testInfo) => {
  const name = uniqueName('mention', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  // A bare @ offers the channel.
  await type(page, name, 'yo @')
  await expect(menu(page)).toBeVisible({ timeout: 15_000 })
  const all = await menu(page).getByRole('option').count()
  expect(all).toBeGreaterThan(0)

  // The first option is highlighted before a single arrow key is pressed, so
  // Enter always has something to complete.
  await expect(menu(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true')

  const first = (await menu(page).getByRole('option').first().getAttribute('data-handle')) ?? ''
  expect(first).not.toBe('')

  // Typing narrows it, and never to more than it started with.
  await composer(page, name).pressSequentially(first.slice(0, 2), { delay: 20 })
  await expect(menu(page)).toBeVisible()
  expect(await menu(page).getByRole('option').count()).toBeLessThanOrEqual(all)

  // Enter completes rather than sends: the menu owns the key while it is open.
  await composer(page, name).press('Enter')
  await expect(menu(page)).toHaveCount(0)
  await expect(composer(page, name)).toHaveValue(`yo @${first} `)

  // And Enter sends once the menu is closed — the composer is unchanged.
  await composer(page, name).pressSequentially('siap', { delay: 20 })
  await composer(page, name).press('Enter')
  await expect(page.getByText(`yo @${first} siap`)).toBeVisible({ timeout: 15_000 })
  await expect(composer(page, name)).toHaveValue('')

  await deleteChannel(page, name)
})

test('moves through the menu with the arrow keys and escapes it', async ({ page }, testInfo) => {
  const name = uniqueName('mentionkeys', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  await type(page, name, '@')
  await expect(menu(page)).toBeVisible({ timeout: 15_000 })
  const options = menu(page).getByRole('option')
  const count = await options.count()

  // Down from the last wraps to the first, which is what a menu this short
  // needs instead of a dead end.
  for (let i = 0; i < count; i += 1) await composer(page, name).press('ArrowDown')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')

  await composer(page, name).press('ArrowUp')
  await expect(options.nth(count - 1)).toHaveAttribute('aria-selected', 'true')

  // Escape dismisses the menu without touching what was typed.
  await composer(page, name).press('Escape')
  await expect(menu(page)).toHaveCount(0)
  await expect(composer(page, name)).toHaveValue('@')

  await deleteChannel(page, name)
})

test('does not mistake an email address for a mention', async ({ page }, testInfo) => {
  const name = uniqueName('mentionmail', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  await type(page, name, 'mail me at riley@lfg')
  await expect(menu(page)).toHaveCount(0)

  await deleteChannel(page, name)
})

test('highlights only the mentions the database recorded', async ({ page }, testInfo) => {
  const name = uniqueName('mentionsend', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  const handles = await offeredHandles(page, name)

  // Name everybody the channel offers, plus a handle nobody holds. Exactly one
  // of the offered people is the author, and naming yourself is not a mention,
  // so the recorded rows must be one fewer than the handles written.
  const body = `${handles.map((h) => `@${h}`).join(' ')} @nobodyatall standby`
  await composer(page, name).fill(body)
  await send(page)
  await expect(page.getByText(body)).toBeVisible({ timeout: 15_000 })

  const row = page
    .getByRole('list', { name: 'Messages' })
    .getByRole('listitem')
    .filter({ hasText: 'standby' })
  const highlighted = row.locator('[data-mention]')

  await expect(highlighted).toHaveCount(handles.length - 1, { timeout: 15_000 })
  for (const text of await highlighted.allInnerTexts()) {
    // A handle nobody holds stays ordinary text, however much it looks the part.
    expect(text).not.toContain('nobodyatall')
    expect(handles).toContain(text.replace('@', ''))
  }

  await deleteChannel(page, name)
})

test('offers a private channel only the people allowed into it', async ({ page }, testInfo) => {
  const open = uniqueName('mentionopen', testInfo.project.name)
  const shut = uniqueName('mentionshut', testInfo.project.name)
  await page.goto('/#/')

  await createChannel(page, open)
  const inTheOpen = await offeredHandles(page, open)

  await createChannel(page, shut, { visibility: 'Private' })
  const behindTheDoor = await offeredHandles(page, shut)

  // A private channel with no overrides admits its creator and nobody else, so
  // the menu must not become a way to read the organization's roster.
  expect(behindTheDoor.length).toBeLessThan(inTheOpen.length)
  expect(behindTheDoor.length).toBeGreaterThan(0)

  await deleteChannel(page, shut)
  await deleteChannel(page, open)
})

test('mentions somebody from inside a thread', async ({ page }, testInfo) => {
  const name = uniqueName('mentionthread', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  await composer(page, name).fill('root message')
  await send(page)
  await expect(page.getByText('root message')).toBeVisible({ timeout: 15_000 })

  await page
    .getByRole('list', { name: 'Messages' })
    .getByRole('listitem')
    .filter({ hasText: 'root message' })
    .getByRole('button', { name: 'Reply in thread' })
    .click()
  await expect(page.getByRole('heading', { name: 'Thread', exact: true })).toBeVisible({
    timeout: 15_000,
  })

  const thread = page.getByRole('group', { name: `Composer for thread in ${name}` })
  await thread.getByRole('textbox').click()
  await thread.getByRole('textbox').pressSequentially('@', { delay: 20 })
  await expect(menu(page)).toBeVisible({ timeout: 15_000 })

  await thread.getByRole('textbox').press('Enter')
  await expect(menu(page)).toHaveCount(0)
  await expect(thread.getByRole('textbox')).toHaveValue(/^@\S+ $/)

  await deleteChannel(page, name)
})
