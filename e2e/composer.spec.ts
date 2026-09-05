import { expect, test, type Page } from '@playwright/test'
import { createChannel, deleteChannel, uniqueName } from './channel-helpers'

/**
 * Phase 2 · C3 — the composer's action row.
 *
 * Emoji, paperclip and send sit together on the right, all three the same
 * size, all three on one line with the field. The assertions here are
 * geometric rather than about class names: what matters is that the three
 * stay a row, stay inside the field's box, and keep their gutter — which is
 * exactly what breaks when somebody adds a fourth action or changes a size.
 */

test.use({ storageState: '.auth/owner.json' })

const composerOf = (page: Page, name: string) =>
  page.getByRole('group', { name: `Composer for ${name}` })

async function boxOf(locator: ReturnType<Page['getByRole']>) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('the element has no box')
  return box
}

test('lays the three actions out on one row inside the field', async ({ page }, testInfo) => {
  const name = uniqueName('composer', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  const composer = composerOf(page, name)
  const emoji = composer.getByRole('button', { name: 'Add emoji', exact: true })
  const attach = composer.getByRole('button', { name: 'Attach file', exact: true })
  const send = composer.getByRole('button', { name: 'Send message', exact: true })

  await expect(emoji).toBeVisible()
  await expect(attach).toBeVisible()
  await expect(send).toBeVisible()

  // Send is an icon now. The word would be a second thing to read in a row
  // that is meant to be scanned.
  await expect(send).toHaveText('')
  await expect(composer.getByRole('button', { name: /^Send$/ })).toHaveCount(0)

  const field = composer.getByRole('textbox', { name: `Message ${name}` })
  const [emojiBox, attachBox, sendBox, fieldBox] = await Promise.all([
    boxOf(emoji),
    boxOf(attach),
    boxOf(send),
    boxOf(field),
  ])

  // A comfortable target, and not a toolbar button.
  for (const box of [emojiBox, attachBox, sendBox]) {
    expect(box.width).toBeGreaterThanOrEqual(32)
    expect(box.height).toBeGreaterThanOrEqual(32)
    expect(box.height).toBeLessThanOrEqual(44)
  }

  // One row: the three centres agree.
  const centre = (box: { y: number; height: number }) => box.y + box.height / 2
  expect(Math.abs(centre(emojiBox) - centre(attachBox))).toBeLessThanOrEqual(1)
  expect(Math.abs(centre(attachBox) - centre(sendBox))).toBeLessThanOrEqual(1)

  // Emoji, paperclip, send — in that order, 4–6px apart.
  const emojiToAttach = attachBox.x - (emojiBox.x + emojiBox.width)
  const attachToSend = sendBox.x - (attachBox.x + attachBox.width)
  for (const gap of [emojiToAttach, attachToSend]) {
    expect(gap).toBeGreaterThanOrEqual(2)
    expect(gap).toBeLessThanOrEqual(9)
  }

  // The field runs the width of the box, so its right edge is the box's: the
  // group keeps a small gutter inside it rather than touching the border.
  const gutter = fieldBox.x + fieldBox.width - (sendBox.x + sendBox.width)
  expect(gutter).toBeGreaterThanOrEqual(6)
  expect(gutter).toBeLessThanOrEqual(14)

  // And the whole row is below the field rather than overlapping it.
  expect(emojiBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height - 1)

  await deleteChannel(page, name)
})

test('keeps the file picker and adds an emoji to the draft', async ({ page }, testInfo) => {
  const name = uniqueName('composeract', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  const composer = composerOf(page, name)
  const field = page.getByRole('textbox', { name: `Message ${name}` })

  // The emoji button is a real action: it puts the glyph where the caret was.
  await field.fill('nice')
  await composer.getByRole('button', { name: 'Add emoji', exact: true }).click()
  await page.getByRole('button', { name: 'Add 🔥', exact: true }).click()
  await expect(field).toHaveValue(/🔥/)
  // And hands the caret straight back, so the next word can just be typed.
  await expect(field).toBeFocused()

  // The paperclip still opens the same input, and the input still uploads.
  await page.getByLabel('Attach files').setInputFiles({
    name: 'composer.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('still working'),
  })

  const pendingList = page.getByRole('list', { name: 'Attachments to send' })
  await expect(pendingList.getByText('composer.txt')).toBeVisible({ timeout: 20_000 })
  await expect(pendingList.getByText('Uploading…')).toHaveCount(0, { timeout: 30_000 })

  // Taken back rather than sent, which also discards the object.
  await page.getByRole('button', { name: 'Remove composer.txt' }).click()
  await expect(pendingList).toHaveCount(0)

  await deleteChannel(page, name)
})
