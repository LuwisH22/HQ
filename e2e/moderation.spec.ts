import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 1.5 · B2 — moderation through the real UI.
 *
 * Serial, and desktop-only (see `playwright.config.ts`): the organization has
 * exactly one non-owner member, so two projects moderating concurrently would
 * fight over the same row. Every action here is reversed before the file ends.
 */

test.use({ storageState: '.auth/owner.json' })
test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/#/members')
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 })

  // Start from a known state. An interrupted run can leave the member
  // suspended or banned, and every test below assumes they are active — an
  // assumption worth enforcing rather than hoping for.
  await restoreMember(page)
})

/**
 * A one-member organization is a legitimate state, not a failure: the second
 * account can be removed at any time from the Supabase dashboard. Skipping
 * says so out loud, where a green run would quietly claim moderation had been
 * exercised when there was nobody to moderate.
 */
async function requireSecondMember(page: Page): Promise<void> {
  const present = await otherMemberRow(page).count()
  test.skip(present === 0, 'the organization has no member other than the owner')
}

async function restoreMember(page: Page): Promise<void> {
  const row = otherMemberRow(page)
  if ((await row.count()) === 0) return
  const banned = await row.getByText('Banned').count()
  const suspended = await row.getByText(/Suspended/).count()
  if (banned === 0 && suspended === 0) return

  await row.getByRole('button', { name: /Actions for/ }).click()
  const label = banned > 0 ? 'Lift ban' : 'Lift suspension'
  await page.getByRole('menuitem', { name: label }).click()
  await page.getByRole('button', { name: label }).click()
  await expect(otherMemberRow(page).getByText(/Banned|Suspended/)).toHaveCount(0, {
    timeout: 20_000,
  })
}

/** The roster row for someone other than the signed-in owner. */
function otherMemberRow(page: Page) {
  return page
    .getByRole('list', { name: 'Members' })
    .getByRole('listitem')
    .filter({ hasNot: page.getByText('You', { exact: true }) })
    .first()
}

test('suspends a member with a reason, then lifts it', async ({ page }) => {
  await requireSecondMember(page)

  const row = otherMemberRow(page)
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: /Actions for/ }).click()
  await page.getByRole('menuitem', { name: 'Suspend access' }).click()

  await expect(page.getByRole('heading', { name: 'Suspend member' })).toBeVisible()

  // A reason is mandatory — the button stays disabled without one.
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: '3 days' }).click()
  await page.getByRole('textbox', { name: 'Reason' }).fill('E2E probe — lifted immediately')
  await page.getByRole('button', { name: 'Suspend', exact: true }).click()

  await expect(otherMemberRow(page).getByText(/Suspended/)).toBeVisible({ timeout: 15_000 })

  // Restore.
  const suspended = otherMemberRow(page)
  await suspended.getByRole('button', { name: /Actions for/ }).click()
  await page.getByRole('menuitem', { name: 'Lift suspension' }).click()
  await page.getByRole('button', { name: 'Lift suspension' }).click()

  await expect(otherMemberRow(page).getByText(/Suspended/)).toHaveCount(0, { timeout: 15_000 })
})

test('requires typing BAN before it will ban, then lifts the ban', async ({ page }) => {
  await requireSecondMember(page)

  const row = otherMemberRow(page)

  await row.getByRole('button', { name: /Actions for/ }).click()
  await page.getByRole('menuitem', { name: 'Ban member' }).click()

  await expect(page.getByRole('heading', { name: 'Ban member' })).toBeVisible()

  // Reason alone is not enough for the one action with no automatic way back.
  await page.getByRole('textbox', { name: 'Reason' }).fill('E2E probe — lifted immediately')
  await expect(page.getByRole('button', { name: 'Ban member' })).toBeDisabled()

  await page.getByRole('textbox', { name: 'Type BAN to confirm' }).fill('BAN')
  await expect(page.getByRole('button', { name: 'Ban member' })).toBeEnabled()
  await page.getByRole('button', { name: 'Ban member' }).click()

  await expect(otherMemberRow(page).getByText('Banned')).toBeVisible({ timeout: 20_000 })

  // Restore.
  const banned = otherMemberRow(page)
  await banned.getByRole('button', { name: /Actions for/ }).click()
  await page.getByRole('menuitem', { name: 'Lift ban' }).click()
  await page.getByRole('button', { name: 'Lift ban' }).click()

  await expect(otherMemberRow(page).getByText('Banned')).toHaveCount(0, { timeout: 20_000 })
})

test('offers no moderation actions on your own row', async ({ page }) => {
  // Self-moderation is refused in Postgres; the interface simply never offers
  // it, which is the same rule expressed twice.
  const ownRow = page
    .getByRole('list', { name: 'Members' })
    .getByRole('listitem')
    .filter({ has: page.getByText('You', { exact: true }) })

  await expect(ownRow).toHaveCount(1)
  await expect(ownRow.getByRole('button', { name: /Actions for/ })).toHaveCount(0)
})
