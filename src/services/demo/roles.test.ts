import { beforeEach, describe, expect, it } from 'vitest'
import { clearDemoCache, db, resetDemoDatabase } from './demo-database'
import { demoOrganizationService, signInAsDemoAdmin } from './index'

/**
 * Phase 1.5 · B1 — the dynamic role model.
 *
 * The demo backend mirrors the database guards, so these tests double as
 * executable documentation of the rules Postgres enforces:
 *
 *   * role names carry no authority whatsoever;
 *   * ownership is a property of the organization, not of a role;
 *   * a member's permissions are the union of every role they hold;
 *   * you may only manage roles strictly below your own authority;
 *   * you cannot delegate a permission you do not hold;
 *   * a member can never be left with zero roles.
 */

beforeEach(async () => {
  localStorage.clear()
  clearDemoCache()
  resetDemoDatabase()
  await signInAsDemoAdmin()
})

async function roleNamed(name: string) {
  const roles = await demoOrganizationService.listRoles('any')
  const role = roles.find((r) => r.name === name)
  if (!role) throw new Error(`no role named ${name}`)
  return role
}

describe('custom roles', () => {
  it('creates a role with a name of the operator’s choosing', async () => {
    const id = await demoOrganizationService.createRole('any', {
      name: 'Tournament Manager',
      description: 'Runs brackets',
      rank: 250,
    })

    const roles = await demoOrganizationService.listRoles('any')
    const created = roles.find((r) => r.id === id)
    expect(created?.name).toBe('Tournament Manager')
    expect(created?.rank).toBe(250)
    expect(created?.isSystem).toBe(false)
  })

  it('renames a provisioned role — they are not special', async () => {
    const player = await roleNamed('Player')
    await demoOrganizationService.updateRole(player.id, 'Competitor', 'Renamed')

    const roles = await demoOrganizationService.listRoles('any')
    expect(roles.find((r) => r.id === player.id)?.name).toBe('Competitor')
    // The rename must not disturb anything else about authority.
    expect(roles.find((r) => r.id === player.id)?.rank).toBe(player.rank)
  })

  it('grants nothing merely for being called "Owner"', async () => {
    const id = await demoOrganizationService.createRole('any', {
      name: 'Owner',
      description: 'A decoy',
      rank: 900,
    })

    const matrix = await demoOrganizationService.getPermissionMatrix('any')
    const grantedToDecoy = matrix.filter((row) => row.grantedRoleIds.has(id))
    expect(grantedToDecoy).toHaveLength(0)
  })

  it('keeps ownership when the role the owner holds is renamed', async () => {
    const owner = await roleNamed('Owner')
    await demoOrganizationService.updateRole(owner.id, 'Chief Wrangler', null)

    const membership = await demoOrganizationService.getCurrentMembership('any')
    expect(membership?.isOwner).toBe(true)
    expect(membership?.permissions.can('organization.delete')).toBe(true)
  })
})

describe('role hierarchy', () => {
  it('refuses to create a role at or above the actor’s own authority', async () => {
    // The owner has no ceiling, so a delegate is needed to test one. Create a
    // rank-100 role that can manage roles, hand it to a non-owner, and act as
    // them.
    const deputyRole = await demoOrganizationService.createRole('any', {
      name: 'Deputy',
      description: null,
      rank: 100,
    })
    await demoOrganizationService.setRolePermissions(deputyRole, [
      'organization.view',
      'roles.manage',
    ])

    const members = await demoOrganizationService.listMembers('any')
    const delegate = members.find((m) => !m.roles.some((r) => r.rank === 0))!
    // Replace their roles entirely: effective rank is the MOST authoritative
    // role held, so leaving the original in place would keep them above 100.
    await demoOrganizationService.updateMemberRole(delegate.id, deputyRole)

    db().currentUserId = delegate.userId

    // Equal authority is not enough: the rule is strictly below.
    await expect(
      demoOrganizationService.createRole('any', {
        name: 'Shadow',
        description: null,
        rank: 100,
      }),
    ).rejects.toThrow(/at or above your own authority/i)

    await expect(
      demoOrganizationService.createRole('any', {
        name: 'Junior',
        description: null,
        rank: 101,
      }),
    ).resolves.toBeTruthy()
  })

  it('refuses to let a delegate edit a role above their own authority', async () => {
    const deputyRole = await demoOrganizationService.createRole('any', {
      name: 'Deputy',
      description: null,
      rank: 100,
    })
    await demoOrganizationService.setRolePermissions(deputyRole, [
      'organization.view',
      'roles.manage',
    ])

    const members = await demoOrganizationService.listMembers('any')
    const delegate = members.find((m) => !m.roles.some((r) => r.rank === 0))!
    // Replace their roles entirely: effective rank is the MOST authoritative
    // role held, so leaving the original in place would keep them above 100.
    await demoOrganizationService.updateMemberRole(delegate.id, deputyRole)

    const ownerRole = await roleNamed('Owner')
    db().currentUserId = delegate.userId

    // Renaming the most authoritative role would be a way to sow confusion
    // even though it grants nothing — the hierarchy check blocks it anyway.
    await expect(demoOrganizationService.updateRole(ownerRole.id, 'Puppet', null)).rejects.toThrow(
      /below your own authority/i,
    )
  })

  it('refuses to delete a role that would strand a member', async () => {
    const members = await demoOrganizationService.listMembers('any')
    const target = members.find((m) => m.roles.length === 1)
    expect(target).toBeDefined()

    await expect(demoOrganizationService.deleteRole(target!.role.id)).rejects.toThrow(
      /hold no other role/i,
    )
  })
})

describe('multiple roles per member', () => {
  it('adds a second role and keeps the most authoritative one primary', async () => {
    const analyst = await demoOrganizationService.createRole('any', {
      name: 'Analyst',
      description: null,
      rank: 800,
    })
    const members = await demoOrganizationService.listMembers('any')
    const target = members.find((m) => !m.roles.some((r) => r.rank === 0))!
    const originalPrimary = target.role.id

    await demoOrganizationService.assignRole(target.id, analyst)

    const after = (await demoOrganizationService.listMembers('any')).find(
      (m) => m.id === target.id,
    )!
    expect(after.roles).toHaveLength(2)
    // rank 800 is the weakest, so it must not become the primary role.
    expect(after.role.id).toBe(originalPrimary)
  })

  it('resolves permissions as the union of every role held', async () => {
    const extra = await demoOrganizationService.createRole('any', {
      name: 'Calendar Keeper',
      description: null,
      rank: 800,
    })
    await demoOrganizationService.setRolePermissions(extra, ['calendar.manage'])

    const members = await demoOrganizationService.listMembers('any')
    const player = members.find((m) => m.role.name === 'Player')
    expect(player).toBeDefined()

    await demoOrganizationService.assignRole(player!.id, extra)

    const matrix = await demoOrganizationService.getPermissionMatrix('any')
    const calendarManage = matrix.find((row) => row.key === 'calendar.manage')!
    expect(calendarManage.grantedRoleIds.has(extra)).toBe(true)
  })

  it('refuses to remove a member’s last role', async () => {
    const members = await demoOrganizationService.listMembers('any')
    const single = members.find((m) => m.roles.length === 1)!

    await expect(demoOrganizationService.unassignRole(single.id, single.role.id)).rejects.toThrow(
      /at least one role/i,
    )
  })
})

describe('permission delegation', () => {
  it('refuses an unknown permission key', async () => {
    const id = await demoOrganizationService.createRole('any', {
      name: 'Probe',
      description: null,
      rank: 900,
    })

    await expect(
      demoOrganizationService.setRolePermissions(id, ['not.a_real_permission']),
    ).rejects.toThrow(/unknown permission/i)
  })

  it('lets the owner delegate anything they hold', async () => {
    const id = await demoOrganizationService.createRole('any', {
      name: 'Finance',
      description: null,
      rank: 300,
    })

    await demoOrganizationService.setRolePermissions(id, ['organization.view', 'files.manage'])

    const matrix = await demoOrganizationService.getPermissionMatrix('any')
    expect(matrix.find((r) => r.key === 'files.manage')!.grantedRoleIds.has(id)).toBe(true)
    expect(matrix.find((r) => r.key === 'organization.delete')!.grantedRoleIds.has(id)).toBe(false)
  })
})
