import { beforeEach, describe, expect, it } from 'vitest'
import { PERMISSIONS } from '@/lib/permissions'
import { AppError } from '@/lib/errors'
import { clearDemoCache, db, DEMO_OWNER_PROFILE_ID, resetDemoDatabase } from './demo-database'
import { PERMISSION_CATALOG } from './permission-catalog'
import {
  demoInvitationService,
  demoOrganizationService,
  demoProfileService,
  signInAsDemoAdmin,
} from './index'

/**
 * Demo mode is a development tool, but it is the surface Phase 1 is exercised
 * against while Supabase is unavailable — so its authorization rules must match
 * the ones the database enforces. If these drift, demo mode teaches behaviour
 * the real backend will reject.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

beforeEach(async () => {
  localStorage.clear()
  clearDemoCache()
  resetDemoDatabase()
  await signInAsDemoAdmin()
})

describe('seed integrity', () => {
  it('gives every entity a well-formed uuid, as the real schema does', () => {
    const database = db()
    expect(database.organization.id).toMatch(UUID_RE)
    for (const role of database.roles) expect(role.id).toMatch(UUID_RE)
    for (const profile of database.profiles) expect(profile.id).toMatch(UUID_RE)
    for (const member of database.members) expect(member.id).toMatch(UUID_RE)
    for (const invitation of database.invitations) expect(invitation.id).toMatch(UUID_RE)
  })

  it('describes every permission in the catalogue', () => {
    // Guards against adding a capability to PERMISSIONS and forgetting the
    // metadata the permission matrix renders from.
    const described = new Set(PERMISSION_CATALOG.map((entry) => entry.key))
    expect([...PERMISSIONS].filter((key) => !described.has(key))).toEqual([])
    expect(PERMISSION_CATALOG).toHaveLength(PERMISSIONS.length)
  })

  it('grants the owner every permission and withholds deletion from the admin', () => {
    const database = db()
    const roleId = (key: string) => database.roles.find((r) => r.key === key)?.id
    const permissionsOf = (key: string) =>
      database.rolePermissions
        .filter((rp) => rp.roleId === roleId(key))
        .map((rp) => rp.permissionKey)

    expect(permissionsOf('owner')).toHaveLength(PERMISSIONS.length)
    expect(permissionsOf('admin')).not.toContain('organization.delete')
    expect(permissionsOf('admin')).toHaveLength(PERMISSIONS.length - 1)
    expect(permissionsOf('player')).not.toContain('members.invite')
    expect(permissionsOf('staff')).not.toContain('files.upload')
  })

  it('orders roles by descending authority', () => {
    const ranks = db()
      .roles.slice()
      .sort((a, b) => a.rank - b.rank)
      .map((r) => r.key)
    expect(ranks).toEqual(['owner', 'admin', 'manager', 'coach', 'player', 'staff'])
  })
})

describe('session', () => {
  it('signs in as the seeded owner', async () => {
    const membership = await demoOrganizationService.getCurrentMembership('any')
    expect(membership?.role.key).toBe('owner')
    expect(db().currentUserId).toBe(DEMO_OWNER_PROFILE_ID)
  })

  it('resolves the full permission set for the owner', async () => {
    const membership = await demoOrganizationService.getCurrentMembership('any')
    expect(membership?.permissions.size).toBe(PERMISSIONS.length)
  })
})

describe('member CRUD', () => {
  it('reads the roster', async () => {
    const members = await demoOrganizationService.listMembers('any')
    expect(members.length).toBeGreaterThan(5)
    expect(members.every((m) => m.profile.email.length > 0)).toBe(true)
  })

  it('changes a role and records it in the audit trail', async () => {
    const members = await demoOrganizationService.listMembers('any')
    const player = members.find((m) => m.role.key === 'player')
    const coachRole = (await demoOrganizationService.listRoles('any')).find(
      (r) => r.key === 'coach',
    )

    await demoOrganizationService.updateMemberRole(player!.id, coachRole!.id)

    const after = await demoOrganizationService.listMembers('any')
    expect(after.find((m) => m.id === player!.id)?.role.key).toBe('coach')
    expect(db().auditLogs[0]?.action).toBe('member.role_changed')
  })

  it('suspends and restores a member', async () => {
    // Status is no longer written directly: moderation goes through routines
    // that also record the reason, the actor and the history.
    const members = await demoOrganizationService.listMembers('any')
    const target = members.find((m) => m.role.key === 'player')!

    await demoOrganizationService.suspendMember(target.id, 'Testing', 7)
    let after = await demoOrganizationService.listMembers('any')
    expect(after.find((m) => m.id === target.id)?.status).toBe('suspended')

    await demoOrganizationService.unsuspendMember(target.id)
    after = await demoOrganizationService.listMembers('any')
    expect(after.find((m) => m.id === target.id)?.status).toBe('active')
  })

  it('removes a member', async () => {
    const before = await demoOrganizationService.listMembers('any')
    const target = before.find((m) => m.role.key === 'staff')!

    await demoOrganizationService.removeMember(target.id)

    const after = await demoOrganizationService.listMembers('any')
    expect(after).toHaveLength(before.length - 1)
    expect(after.some((m) => m.id === target.id)).toBe(false)
  })
})

describe('authorization rules mirror the database guards', () => {
  it("lets the owner's roles change without affecting their authority", async () => {
    // Ownership is a column on the organization, not a role. Demoting the
    // owner is therefore harmless, and must not reduce what they can do —
    // otherwise an administrator could lock an owner out of their own
    // organization by editing roles.
    const members = await demoOrganizationService.listMembers('any')
    const owner = members.find((m) => m.role.key === 'owner')!
    const playerRole = (await demoOrganizationService.listRoles('any')).find(
      (r) => r.key === 'player',
    )!

    await demoOrganizationService.updateMemberRole(owner.id, playerRole.id)

    const membership = await demoOrganizationService.getCurrentMembership('any')
    expect(membership?.isOwner).toBe(true)
    expect(membership?.role.key).toBe('player')
    expect(membership?.permissions.can('organization.delete')).toBe(true)
  })

  it('refuses to suspend the organization owner', async () => {
    // The demo admin IS the owner, and self-moderation is refused first — so a
    // delegate is needed to reach the owner-protection rule at all.
    const deputy = await demoOrganizationService.createRole('any', {
      name: 'Deputy',
      description: null,
      rank: 5,
    })
    await demoOrganizationService.setRolePermissions(deputy, [
      'organization.view',
      'members.view',
      'members.suspend',
    ])

    const members = await demoOrganizationService.listMembers('any')
    const owner = members.find((m) => m.role.key === 'owner')!
    const delegate = members.find((m) => m.role.key !== 'owner')!
    await demoOrganizationService.updateMemberRole(delegate.id, deputy)

    db().currentUserId = delegate.userId

    await expect(
      demoOrganizationService.suspendMember(owner.id, 'Should be impossible', 7),
    ).rejects.toThrow(/owner cannot be moderated/i)
  })

  it('refuses to remove the last remaining owner', async () => {
    const members = await demoOrganizationService.listMembers('any')
    const owner = members.find((m) => m.role.key === 'owner')!

    await expect(demoOrganizationService.removeMember(owner.id)).rejects.toThrow(
      /owner cannot be removed/i,
    )
  })

  it('rejects an invitation for someone who is already a member', async () => {
    const roles = await demoOrganizationService.listRoles('any')
    const existing = db().profiles[1]!

    await expect(
      demoInvitationService.create({
        organizationId: 'any',
        email: existing.email,
        roleId: roles.find((r) => r.key === 'player')!.id,
      }),
    ).rejects.toThrow(/already a member/i)
  })
})

describe('invitation CRUD', () => {
  it('creates, lists and revokes an invitation', async () => {
    const roles = await demoOrganizationService.listRoles('any')
    const playerRole = roles.find((r) => r.key === 'player')!

    const created = await demoInvitationService.create({
      organizationId: 'any',
      email: 'New.Recruit@LFG.test',
      roleId: playerRole.id,
    })
    expect(created.email).toBe('new.recruit@lfg.test')

    const listed = await demoInvitationService.list('any')
    expect(listed.find((i) => i.id === created.id)?.status).toBe('pending')

    await demoInvitationService.revoke(created.id)
    const afterRevoke = await demoInvitationService.list('any')
    expect(afterRevoke.find((i) => i.id === created.id)?.status).toBe('revoked')
  })

  it('reports a lapsed invitation as expired without being asked to', async () => {
    const listed = await demoInvitationService.list('any')
    expect(listed.some((i) => i.status === 'expired')).toBe(true)
  })

  it('will not delete an invitation that is still pending', async () => {
    const pending = (await demoInvitationService.list('any')).find((i) => i.status === 'pending')!
    await expect(demoInvitationService.deleteSpent(pending.id)).rejects.toBeInstanceOf(AppError)
  })
})

describe('persistence', () => {
  it('survives a reload of the store', async () => {
    await demoProfileService.update({ title: 'Interim Head of Ops' })

    // Simulate a page reload: drop the in-memory copy and re-read storage.
    clearDemoCache()

    const profile = await demoProfileService.getMine()
    expect(profile?.title).toBe('Interim Head of Ops')
  })

  it('does not lose unrelated fields when updating one', async () => {
    const before = await demoProfileService.getMine()
    await demoProfileService.update({ title: 'Something else' })
    const after = await demoProfileService.getMine()

    expect(after?.timezone).toBe(before?.timezone)
    expect(after?.displayName).toBe(before?.displayName)
  })
})
