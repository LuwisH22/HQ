import { expect, test, type Page } from '@playwright/test'
import {
  createChannel as createChannelViaSidebar,
  deleteChannel,
  main,
  openNav,
  uniqueName as uniqueChannelName,
} from './channel-helpers'

/**
 * Phase 2 · C1 — chat through the real UI.
 *
 * Each run works in its own channel, created and deleted here: the desktop and
 * mobile projects run concurrently against the same organization, and sharing
 * a channel would mean asserting on each other's messages.
 */

test.use({ storageState: '.auth/owner.json' })

function uniqueName(project: string): string {
  return uniqueChannelName('chat', project)
}

/** Create a channel and land in its conversation. */
async function createChannel(page: Page, name: string): Promise<void> {
  await page.goto('/#/')
  await createChannelViaSidebar(page, name)
}

async function openChannel(page: Page, name: string): Promise<void> {
  await page.goto('/#/channels')
  await expect(page.getByRole('heading', { name: 'Channels', level: 1 })).toBeVisible({
    timeout: 20_000,
  })
  await main(page).getByRole('link').filter({ hasText: name }).first().click()
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 })
}

test('opens and switches channels from the navigation', async ({ page }, testInfo) => {
  const first = uniqueName(testInfo.project.name)
  const second = `${uniqueName(testInfo.project.name)}-alt`
  await createChannel(page, first)
  await createChannel(page, second)

  // Starting somewhere else entirely: reaching a conversation must not mean
  // going through the directory first.
  await page.goto('/#/')
  await openNav(page)
  await page.getByRole('link', { name: first, exact: true }).click()
  await expect(page.getByRole('heading', { name: first })).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/#\/channels\//)

  // And switching is one click, from inside the conversation.
  await openNav(page)
  await page.getByRole('link', { name: second, exact: true }).click()
  await expect(page.getByRole('heading', { name: second })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('textbox', { name: `Message ${second}` })).toBeVisible()

  await deleteChannel(page, first)
  await deleteChannel(page, second)
})

/** The panel's collapse control, which is a sheet toggle on a phone. */
function panelToggle(page: Page) {
  return page.getByRole('button', { name: /(Open|Close) panel/ }).first()
}

test('opens the channel panel by default and collapses it on request', async ({
  page,
}, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)

  const panel = page.getByRole('complementary', { name: 'Channel details' })
  const isMobile = testInfo.project.name === 'mobile'

  if (isMobile) {
    // A phone has no room for a permanent second column, so the panel is a
    // sheet the same control opens.
    await expect(panel).toHaveCount(0)
    await panelToggle(page).click()
    await expect(page.getByRole('list', { name: 'Channel members' })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: 'Close panel' }).first().click()
    await expect(page.getByRole('list', { name: 'Channel members' })).toHaveCount(0)
  } else {
    // Open on arrival: a panel nobody knows to look for may as well not exist.
    await expect(panel).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close panel' })).toBeVisible()

    await panelToggle(page).click()
    await expect(panel).toBeHidden()
    await expect(page.getByRole('button', { name: 'Open panel' })).toBeVisible()

    await panelToggle(page).click()
    await expect(panel).toBeVisible()
  }

  // The member count moved into the panel; it is not the header control.
  await expect(page.getByRole('button', { name: /members/i })).toHaveCount(0)

  await deleteChannel(page, name)
})

test('widens the conversation when the panel closes, without stranding it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'The panel is a sheet on phones, not a column.')

  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)

  const composer = page.getByRole('textbox', { name: `Message ${name}` })
  const openBox = await composer.boundingBox()

  await panelToggle(page).click()
  await expect(page.getByRole('button', { name: 'Open panel' })).toBeVisible()
  // Past the 240ms transition.
  await page.waitForTimeout(600)

  const closedBox = await composer.boundingBox()
  expect(openBox).not.toBeNull()
  expect(closedBox).not.toBeNull()

  // The conversation gets the space the panel gave up...
  expect(closedBox!.width).toBeGreaterThan(openBox!.width)

  // ...and stays centred rather than sliding to the far-left edge. Measured
  // against the chat area, not the viewport: the sidebar occupies the first
  // 256px of the window and is not space the conversation was ever offered.
  const area = (await page.getByRole('main').boundingBox())!
  const leftGap = closedBox!.x - area.x
  const rightGap = area.x + area.width - (closedBox!.x + closedBox!.width)
  expect(Math.abs(leftGap - rightGap)).toBeLessThan(2)
  // And it is not flush against anything.
  expect(leftGap).toBeGreaterThan(8)

  await panelToggle(page).click()
  await deleteChannel(page, name)
})

test('names the channel and its members inside the panel', async ({ page }, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)

  if (testInfo.project.name === 'mobile') await panelToggle(page).click()

  const roster = page.getByRole('list', { name: 'Channel members' })
  await expect(roster).toBeVisible({ timeout: 15_000 })
  await expect(roster.getByRole('listitem').first()).toBeVisible()

  // The sections future work plugs into are present and honest about being
  // empty rather than absent.
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expect(page.getByText('No active voice session.')).toBeVisible()
  await expect(page.getByText('No active stream.')).toBeVisible()

  await deleteChannel(page, name)
})

test('sends a message with Enter and keeps Shift+Enter for a new line', async ({
  page,
}, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  const composer = page.getByRole('textbox', { name: `Message ${name}` })
  await composer.click()
  await composer.pressSequentially('first line')
  await composer.press('Shift+Enter')
  await composer.pressSequentially('second line')

  // Still a draft: Shift+Enter breaks the line rather than sending.
  await expect(page.getByText('No messages yet')).toBeVisible()
  // Written as a pattern rather than a literal so the newline between the two
  // lines is the thing under test, not something to escape into the source.
  await expect(composer).toHaveValue(/^first line\s+second line$/)

  await composer.press('Enter')
  await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('listitem').filter({ hasText: 'second line' })).toBeVisible()
  await expect(composer).toHaveValue('')

  await deleteChannel(page, name)
})

test('sends, edits and deletes a message', async ({ page }, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  const composer = page.getByRole('textbox', { name: `Message ${name}` })

  await expect(page.getByText('No messages yet')).toBeVisible()

  await composer.fill('first message from the suite')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('first message from the suite')).toBeVisible({ timeout: 15_000 })

  // The composer clears itself, so a second send is not a duplicate.
  await expect(composer).toHaveValue('')

  const row = page.getByRole('listitem').filter({ hasText: 'first message from the suite' })
  await row.getByRole('button', { name: /Actions for message/ }).click()
  await page.getByRole('menuitem', { name: 'Edit message' }).click()

  const editor = page.getByRole('textbox', { name: 'Edit message' })
  await editor.fill('edited by the suite')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByText('edited by the suite')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('(edited)')).toBeVisible()

  // Soft delete: the row stays, the words go.
  const edited = page.getByRole('listitem').filter({ hasText: 'edited by the suite' })
  await edited.getByRole('button', { name: /Actions for message/ }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('menuitem', { name: 'Delete message' }).click()

  await expect(page.getByText('This message was deleted.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('edited by the suite')).toHaveCount(0)

  await deleteChannel(page, name)
})

test('pins and unpins a message', async ({ page }, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  await page.getByRole('textbox', { name: `Message ${name}` }).fill('worth pinning')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('worth pinning')).toBeVisible({ timeout: 15_000 })

  const row = page.getByRole('listitem').filter({ hasText: 'worth pinning' })
  await row.getByRole('button', { name: /Actions for message/ }).click()
  await page.getByRole('menuitem', { name: 'Pin message' }).click()
  await expect(page.getByRole('img', { name: 'Pinned', exact: true })).toBeVisible({
    timeout: 15_000,
  })

  const pinned = page.getByRole('listitem').filter({ hasText: 'worth pinning' })
  await pinned.getByRole('button', { name: /Actions for message/ }).click()
  await page.getByRole('menuitem', { name: 'Unpin message' }).click()
  await expect(page.getByRole('img', { name: 'Pinned', exact: true })).toHaveCount(0, {
    timeout: 15_000,
  })

  await deleteChannel(page, name)
})

test('never shows your own typing indicator back to you', async ({ page }, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  // Typing is broadcast with `self: false` and the sender's id is filtered
  // anyway, so nothing should appear no matter how much is typed.
  const composer = page.getByRole('textbox', { name: `Message ${name}` })
  await composer.pressSequentially('typing away here', { delay: 30 })

  await expect(page.getByText(/is typing|are typing/)).toHaveCount(0)

  await deleteChannel(page, name)
})

test('keeps a run of messages compact and a long one intact', async ({ page }, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  const composer = page.getByRole('textbox', { name: `Message ${name}` })
  const send = page.getByRole('button', { name: 'Send' })

  // One author, one minute: the first message opens the group and the rest
  // continue it, which is how a burst is meant to read as one person talking.
  const run = ['memeg', 'slurpies', 'kecepatan setahun', 'yagasi', 'kenapa jadi gini']
  for (const line of run) {
    await composer.fill(line)
    await send.click()
    await expect(page.getByText(line, { exact: true })).toBeVisible({ timeout: 15_000 })
  }
  await composer.fill('satu\ndua\ntiga')
  await send.click()
  // Matched as a pattern: the three lines are one text node, not three.
  await expect(page.getByText(/satu\s+dua\s+tiga/)).toBeVisible({ timeout: 15_000 })

  const measured = await page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('ul[aria-label="Messages"] li'),
    ).filter((li) => li.querySelector('p.whitespace-pre-wrap'))

    const line = (li: HTMLElement) => {
      const body = li.querySelector<HTMLElement>('p.whitespace-pre-wrap')
      const gutter = li.querySelector<HTMLElement>('div.w-8 > span')
      const lineHeight = body ? Number.parseFloat(getComputedStyle(body).lineHeight) : 0
      return {
        text: li.innerText,
        top: li.getBoundingClientRect().top,
        height: li.getBoundingClientRect().height,
        body: body ? body.getBoundingClientRect().height : 0,
        lineHeight,
        // A message that opens a group keeps its author's name and the space
        // that sets it apart; a continuation has neither.
        opensGroup: li.querySelectorAll('p').length > 1,
        marginTop: Number.parseFloat(getComputedStyle(li).marginTop),
        gutterLines:
          gutter && lineHeight > 0
            ? Math.ceil(gutter.getBoundingClientRect().height / lineHeight)
            : 0,
      }
    }

    return rows.map(line)
  })

  const continued = measured.filter((row) => !row.opensGroup)
  const oneLiners = continued.filter((row) => !row.text.includes('satu'))
  const multiLine = continued.find((row) => row.text.includes('satu'))

  expect(oneLiners).toHaveLength(run.length - 1)
  expect(multiLine).toBeDefined()

  const lineHeight = oneLiners[0].lineHeight
  expect(lineHeight).toBeGreaterThan(0)

  for (const row of oneLiners) {
    // One line of text, and the row is that line plus its own padding —
    // nothing in it reserves space for a second.
    expect(Math.round(row.body)).toBe(Math.round(lineHeight))
    expect(row.height).toBeLessThanOrEqual(row.body + 8)
    expect(row.gutterLines).toBe(1)
    // Continuations sit directly under one another; only a new group is spaced.
    expect(row.marginTop).toBe(0)
  }

  // Consecutive rows are exactly as far apart as the row above is tall: no
  // collapsed margin, no phantom gap between them.
  for (let i = 1; i < oneLiners.length; i += 1) {
    const gap = oneLiners[i].top - oneLiners[i - 1].top
    expect(gap).toBeCloseTo(oneLiners[i - 1].height, 0)
    expect(gap).toBeLessThanOrEqual(lineHeight + 8)
  }

  // Three lines are three lines tall: the compactness above must not have come
  // from clamping a message to one.
  expect(Math.round(multiLine!.body)).toBe(Math.round(lineHeight * 3))
  expect(multiLine!.height).toBeLessThanOrEqual(multiLine!.body + 8)

  // And the message that opened the group keeps the wider separation that
  // marks a change of speaker.
  const opener = measured.find((row) => row.opensGroup)
  expect(opener).toBeDefined()
  expect(opener!.marginTop).toBeGreaterThan(oneLiners[0].marginTop)

  await deleteChannel(page, name)
})
