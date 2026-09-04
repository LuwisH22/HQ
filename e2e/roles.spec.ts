import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 1.5 · B1 — role management through the real UI.
 *
 * Every role created here is deleted again, so a passing run leaves the
 * organization as it found it. Names are made unique per project and per run:
 * the desktop and mobile projects execute concurrently against the same live
 * organization, and a shared literal name makes them delete each other's roles.
 */

test.use({ storageState: '.auth/owner.json' })

function uniqueName(prefix: string, project: string): string {
  return `${prefix} ${project} ${String(Date.now() % 100000)}`
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings/roles')
  await expect(page.getByRole('heading', { name: 'Roles' }).first()).toBeVisible({
    timeout: 20_000,
  })
})

async function createRole(
  page: Page,
  name: string,
  rank: string,
  options: { grantViewOrganization?: boolean } = {},
): Promise<void> {
  await page.getByRole('button', { name: 'New role' }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await page.getByRole('spinbutton', { name: 'Rank' }).fill(rank)
  if (options.grantViewOrganization) {
    await page.getByRole('checkbox', { name: /^View organization/i }).first().check()
  }
  await page.getByRole('button', { name: 'Create role' }).click()
}

async function deleteRole(
  page: Page,
  name: string,
): Promise<void> {
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: `Delete ${name}` }).click()
  await expect(page.getByRole('list', { name: 'Roles' }).getByText(name)).toHaveCount(0, {
    timeout: 15_000,
  })
}

test('creates a custom role, edits its permissions, then deletes it', async ({ page }, testInfo) => {
  const name = uniqueName('E2E Probe', testInfo.project.name)
  const roles = page.getByRole('list', { name: 'Roles' })

  await createRole(page, name, '700', { grantViewOrganization: true })
  await expect(roles.getByText(name)).toBeVisible({ timeout: 15_000 })

  // Re-open it: the editor must show the permission that was just granted.
  await page.getByRole('button', { name: `Edit ${name}` }).click()
  await expect(page.getByRole('heading', { name: `Edit ${name}` })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /^View organization/i }).first()).toBeChecked()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await deleteRole(page, name)
})

test('a role named "Owner" grants nothing and does not move ownership', async ({
  page,
}, testInfo) => {
  // The decoy is literally called Owner, plus a unique suffix so the two
  // projects do not collide. If names carried authority, this would be an
  // escalation; it must be completely inert.
  const name = uniqueName('Owner', testInfo.project.name)
  const roles = page.getByRole('list', { name: 'Roles' })

  await createRole(page, name, '950')
  await expect(roles.getByText(name)).toBeVisible({ timeout: 15_000 })

  // Ownership is unchanged, so administration is still available.
  await page.goto('/#/members')
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
  await page.goto('/#/settings/roles')

  await deleteRole(page, name)
})

test('offers no rank that would match the editor’s own authority', async ({ page }) => {
  await page.getByRole('button', { name: 'New role' }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Impossible')

  // The owner's effective rank is -1, so 0 is the lowest a role can sit — no
  // role can ever tie them. The database refuses the same edit independently.
  await expect(page.getByRole('spinbutton', { name: 'Rank' })).toHaveAttribute('min', '0')

  await page.getByRole('button', { name: 'Cancel' }).click()
})
