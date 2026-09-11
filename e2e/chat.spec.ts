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

  // The sections are present and honest. Voice says where it lives — this is
  // a text channel, and there is no call to be had in one — rather than
  // reporting an empty session that could never be full. Streaming used to
  // sit beside it saying "No active stream", which reported the state of
  // something that does not exist; the row is gone rather than fictional.
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expect(page.getByText('Voice lives in voice channels.')).toBeVisible()
  await expect(page.getByText('No active stream.')).toHaveCount(0)

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
  await page.getByRole('button', { name: 'Send message' }).click()
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
  await page.getByRole('button', { name: 'Send message' }).click()
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

/**
 * What a bubble adds around the words, in pixels.
 *
 * 6px of padding and a 1px border top and bottom, plus the row's own 1px — the
 * 2px that separates one message in a group from the next. A message is
 * therefore its own text plus this and nothing else; a phantom second line
 * would add a whole 22px line height, which is well clear of it.
 */
const BUBBLE_CHROME = 16

test('keeps a run of messages compact and a long one intact', async ({ page }, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  const composer = page.getByRole('textbox', { name: `Message ${name}` })
  const send = page.getByRole('button', { name: 'Send message' })

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
      const gutter = li.querySelector<HTMLElement>('[data-message-gutter] > span')
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
    // One line of text, and the row is that line plus the bubble around it —
    // nothing in it reserves space for a second.
    expect(Math.round(row.body)).toBe(Math.round(lineHeight))
    expect(row.height).toBeLessThanOrEqual(row.body + BUBBLE_CHROME)
    expect(row.gutterLines).toBe(1)
    // Continuations sit directly under one another; only a new group is spaced.
    expect(row.marginTop).toBe(0)
  }

  // Consecutive rows are exactly as far apart as the row above is tall: no
  // collapsed margin, no phantom gap between them.
  for (let i = 1; i < oneLiners.length; i += 1) {
    const gap = oneLiners[i].top - oneLiners[i - 1].top
    expect(gap).toBeCloseTo(oneLiners[i - 1].height, 0)
    expect(gap).toBeLessThanOrEqual(lineHeight + BUBBLE_CHROME)
  }

  // Three lines are three lines tall: the compactness above must not have come
  // from clamping a message to one.
  expect(Math.round(multiLine!.body)).toBe(Math.round(lineHeight * 3))
  expect(multiLine!.height).toBeLessThanOrEqual(multiLine!.body + BUBBLE_CHROME)

  // And the message that opened the group keeps the wider separation that
  // marks a change of speaker.
  const opener = measured.find((row) => row.opensGroup)
  expect(opener).toBeDefined()
  expect(opener!.marginTop).toBeGreaterThan(oneLiners[0].marginTop)

  await deleteChannel(page, name)
})

test('keeps the hover timestamp in the gutter, clear of the words', async ({ page }, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  const composer = page.getByRole('textbox', { name: `Message ${name}` })
  const send = page.getByRole('button', { name: 'Send message' })

  await composer.fill('opening line')
  await send.click()
  await expect(page.getByText('opening line', { exact: true })).toBeVisible({ timeout: 15_000 })
  await composer.fill('my name is luwis')
  await send.click()
  await expect(page.getByText('my name is luwis', { exact: true })).toBeVisible({ timeout: 15_000 })

  // The timestamp only shows on hover, which is what a reader would do to see
  // it. Its geometry is the same either way; the hover is here so the test
  // measures what somebody actually looks at.
  const row = page
    .getByRole('list', { name: 'Messages' })
    .getByRole('listitem')
    .filter({ hasText: 'my name is luwis' })
  await row.hover()

  const measured = await row.evaluate((li) => {
    const stamp = li.querySelector<HTMLElement>('[data-message-gutter] > span')
    const gutter = li.querySelector<HTMLElement>('[data-message-gutter]')
    const body = li.querySelector<HTMLElement>('p.whitespace-pre-wrap')
    if (!stamp || !gutter || !body) return null

    // The painted text, not the box around it. The box never overlapped
    // anything; it was the glyphs spilling out of a box too narrow to hold
    // them that reached into the message, so measuring the element would
    // have missed the defect entirely.
    const ink = document.createRange()
    ink.selectNodeContents(stamp)

    const lineHeight = Number.parseFloat(getComputedStyle(body).lineHeight)
    return {
      text: stamp.textContent ?? '',
      stampRight: ink.getBoundingClientRect().right,
      stampWidth: ink.getBoundingClientRect().width,
      gutterRight: gutter.getBoundingClientRect().right,
      bodyLeft: body.getBoundingClientRect().left,
      bodyHeight: body.getBoundingClientRect().height,
      rowHeight: li.getBoundingClientRect().height,
      stampLines: Math.ceil(
        stamp.getBoundingClientRect().height /
          Number.parseFloat(getComputedStyle(stamp).lineHeight),
      ),
      lineHeight,
    }
  })

  if (!measured) throw new Error('the continued message was not in the timeline')

  // There is a time to read at all, and it is one line of it.
  expect(measured.text).toMatch(/\d/)
  expect(measured.stampWidth).toBeGreaterThan(0)
  expect(measured.stampLines).toBe(1)

  // It stops at the gutter's edge and leaves the gap the row was designed
  // with, rather than running into the first characters of the message.
  expect(measured.stampRight).toBeLessThanOrEqual(measured.gutterRight)
  expect(measured.bodyLeft - measured.stampRight).toBeGreaterThanOrEqual(8)

  // And none of that cost the row any height beyond the bubble's own.
  expect(Math.round(measured.bodyHeight)).toBe(Math.round(measured.lineHeight))
  expect(measured.rowHeight).toBeLessThanOrEqual(measured.bodyHeight + BUBBLE_CHROME)

  await deleteChannel(page, name)
})

test('gives the conversation the whole width of the column it is in', async ({
  page,
}, testInfo) => {
  const name = uniqueName(testInfo.project.name)
  await createChannel(page, name)
  await openChannel(page, name)

  await page.getByRole('textbox', { name: `Message ${name}` }).fill('a line to measure')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('a line to measure', { exact: true })).toBeVisible({
    timeout: 15_000,
  })

  const layout = async () =>
    page.evaluate(() => {
      const list = document.querySelector('ul[aria-label="Messages"]')
      const column = list?.closest('div.overflow-y-auto') ?? null
      const row = list?.querySelector('li') ?? null
      const group = document.querySelector('[role="group"][aria-label^="Composer for"]')
      // The bordered box, which is what a reader sees as the composer; the
      // group around it spans the column and carries the gutter as padding,
      // exactly as the message row does.
      const composer = group?.querySelector('[data-composer-box]') ?? null
      if (!column || !row || !composer) return null

      const columnBox = column.getBoundingClientRect()
      const rowBox = row.getBoundingClientRect()
      const composerBox = composer.getBoundingClientRect()
      const rowStyle = getComputedStyle(row)

      return {
        column: Math.round(columnBox.width),
        // The row itself, which is also what the hover background fills.
        row: Math.round(rowBox.width),
        rowLeftGap: Math.round(rowBox.left - columnBox.left),
        rowRightGap: Math.round(columnBox.right - rowBox.right),
        // Inside the row, which is where the words actually start. The band is
        // inset from the column, so the gutter is that inset plus the padding.
        textGutter:
          Number.parseFloat(rowStyle.marginLeft) + Number.parseFloat(rowStyle.paddingLeft),
        composerLeftGap: Math.round(composerBox.left - columnBox.left),
        composerRightGap: Math.round(columnBox.right - composerBox.right),
      }
    })

  const before = await layout()
  if (!before) throw new Error('the conversation was not on screen')

  // The row tracks the column: no centred box, no dead margin either side.
  // This is what a `max-width` on the wrapper would break, and it broke it
  // silently — at 1440px the clamp does not bite, so only a wide window showed
  // it. The hover band is inset a token from each edge and nothing more, so
  // the two gaps are equal and small.
  expect(before.rowLeftGap).toBe(before.rowRightGap)
  expect(before.rowLeftGap).toBeLessThanOrEqual(8)
  expect(before.row).toBe(before.column - before.rowLeftGap - before.rowRightGap)

  // A gutter, though: the words must not touch the edges.
  expect(before.textGutter).toBeGreaterThanOrEqual(16)
  expect(before.textGutter).toBeLessThanOrEqual(20)

  // And the composer keeps the same gutter as the rows above it, on both sides.
  expect(before.composerLeftGap).toBe(before.composerRightGap)
  expect(before.composerLeftGap).toBeGreaterThanOrEqual(12)
  expect(before.composerLeftGap).toBeLessThanOrEqual(20)

  if (testInfo.project.name !== 'mobile') {
    // Wide enough that a thousand-pixel clamp would leave a visible margin on
    // each side, which is exactly how this was reported.
    await page.setViewportSize({ width: 1920, height: 1000 })
    await page.waitForTimeout(400)

    const wide = await layout()
    if (!wide) throw new Error('the conversation was not on screen')

    expect(wide.column).toBeGreaterThan(before.column)
    expect(wide.row).toBe(wide.column - wide.rowLeftGap - wide.rowRightGap)
    expect(wide.rowLeftGap).toBe(wide.rowRightGap)
    expect(wide.composerLeftGap).toBe(wide.composerRightGap)
    expect(wide.composerLeftGap).toBeLessThanOrEqual(20)

    await page.setViewportSize({ width: 1440, height: 900 })
  }

  await deleteChannel(page, name)
})
