import { beforeEach, describe, expect, it } from 'vitest'
import { clearDemoCache, db, resetDemoDatabase } from './demo-database'
import { demoOrganizationService, signInAsDemoAdmin } from './index'

/**
 * Phase 1.5 · B2 — moderation.
 *
 * The demo backend mirrors the database routines, so these double as
 * executable documentation of what Postgres enforces:
 *
 *   * a reason is always required, and the history cannot be forged;
 *   * a lapsed suspension restores access with nothing written;
 *   * a ban never lapses;
 *   * nobody can moderate themselves, the owner, or a peer;
 *   * roles survive a ban and an unban untouched.
 */

beforeEach(async () => {
  localStorage.clear()
  clearDemoCache()
  resetDemoDatabase()
  await signInAsDemoAdmin()
})

async function someoneOtherThanTheOwner() {
  const members = await demoOrganizationService.listMembers('any')
  const target = members.find((m) => !m.roles.some((r) => r.rank === 0))
  if (!target) throw new Error('no non-owner member in the seed')
  return target
}

describe('suspension', () => {
  it('records status, expiry, reason and history', async () => {
    const target = await someoneOtherThanTheOwner()
    await demoOrganizationService.suspendMember(target.id, 'Missed three scrims', 7)

    const after = (await demoOrganizationService.listMembers('any')).find(
      (m) => m.id === target.id,
    )!
    expect(after.status).toBe('suspended')
    expect(after.moderationReason).toBe('Missed three scrims')
    expect(after.suspendedUntil).not.toBeNull()

    const history = await demoOrganizationService.listModerationHistory('any', target.userId)
    expect(history).toHaveLength(1)
    expect(history[0]?.action).toBe('suspend')
    expect(history[0]?.reason).toBe('Missed three scrims')
    expect(history[0]?.expiresAt).not.toBeNull()
  })

  it('requires a reason', async () => {
    const target = await someoneOtherThanTheOwner()
    await expect(demoOrganizationService.suspendMember(target.id, '   ', 7)).rejects.toThrow(
      /reason is required/i,
    )
  })

  it('refuses a nonsensical duration', async () => {
    const target = await someoneOtherThanTheOwner()
    await expect(demoOrganizationService.suspendMember(target.id, 'Testing', 0)).rejects.toThrow(
      /between 1 and 365/i,
    )
    await expect(demoOrganizationService.suspendMember(target.id, 'Testing', 400)).rejects.toThrow(
      /between 1 and 365/i,
    )
  })

  it('strips a suspended member of every permission', async () => {
    const target = await someoneOtherThanTheOwner()
    await demoOrganizationService.suspendMember(target.id, 'Testing', 7)

    db().currentUserId = target.userId
    const membership = await demoOrganizationService.getCurrentMembership('any')
    // Roles are untouched, but they grant nothing while access is paused.
    expect(membership?.roles.length).toBeGreaterThan(0)
    expect(membership?.permissions.size).toBe(0)
  })

  it('restores access on its own once the expiry passes', async () => {
    const target = await someoneOtherThanTheOwner()
    await demoOrganizationService.suspendMember(target.id, 'Short ban', 1)

    // Reach into the store to move the expiry into the past. Nothing else is
    // touched: no job runs, no status is rewritten.
    const stored = db().members.find((m) => m.id === target.id)!
    stored.suspendedUntil = new Date(Date.now() - 1000).toISOString()

    db().currentUserId = target.userId
    const membership = await demoOrganizationService.getCurrentMembership('any')
    expect(membership?.permissions.size).toBeGreaterThan(0)
    // The stored row still says suspended — access is derived, not written.
    expect(stored.status).toBe('suspended')
  })

  it('lifts a suspension explicitly', async () => {
    const target = await someoneOtherThanTheOwner()
    await demoOrganizationService.suspendMember(target.id, 'Testing', 7)
    await demoOrganizationService.unsuspendMember(target.id, 'Sorted out')

    const after = (await demoOrganizationService.listMembers('any')).find(
      (m) => m.id === target.id,
    )!
    expect(after.status).toBe('active')
    expect(after.suspendedUntil).toBeNull()

    const history = await demoOrganizationService.listModerationHistory('any', target.userId)
    expect(history.map((h) => h.action)).toEqual(['unsuspend', 'suspend'])
  })

  it('refuses to lift a suspension that is not there', async () => {
    const target = await someoneOtherThanTheOwner()
    await expect(demoOrganizationService.unsuspendMember(target.id)).rejects.toThrow(
      /not suspended/i,
    )
  })
})

describe('ban', () => {
  it('blocks access and never lapses', async () => {
    const target = await someoneOtherThanTheOwner()
    await demoOrganizationService.banMember(target.id, 'Leaked internal strategy')

    const after = (await demoOrganizationService.listMembers('any')).find(
      (m) => m.id === target.id,
    )!
    expect(after.status).toBe('banned')
    // A ban carries no expiry, so nothing can turn it into an accidental unban.
    expect(after.suspendedUntil).toBeNull()

    db().currentUserId = target.userId
    const membership = await demoOrganizationService.getCurrentMembership('any')
    expect(membership?.permissions.size).toBe(0)
  })

  it('requires a reason', async () => {
    const target = await someoneOtherThanTheOwner()
    await expect(demoOrganizationService.banMember(target.id, '')).rejects.toThrow(
      /reason is required/i,
    )
  })

  it('is honest that demo mode cannot revoke an auth session', async () => {
    const target = await someoneOtherThanTheOwner()
    const result = await demoOrganizationService.banMember(target.id, 'Testing')
    expect(result.authUpdated).toBe(false)
    expect(result.warning).toMatch(/does not revoke/i)
  })

  it('restores access on unban and leaves roles alone', async () => {
    const target = await someoneOtherThanTheOwner()
    const rolesBefore = target.roles.map((r) => r.id).sort()

    await demoOrganizationService.banMember(target.id, 'Testing')
    await demoOrganizationService.unbanMember(target.id, 'Appeal upheld')

    const after = (await demoOrganizationService.listMembers('any')).find(
      (m) => m.id === target.id,
    )!
    expect(after.status).toBe('active')
    // A ban is about access, not about what someone was brought in to do.
    expect(after.roles.map((r) => r.id).sort()).toEqual(rolesBefore)

    const history = await demoOrganizationService.listModerationHistory('any', target.userId)
    expect(history.map((h) => h.action)).toEqual(['unban', 'ban'])
  })

  it('refuses to unban someone who is not banned', async () => {
    const target = await someoneOtherThanTheOwner()
    await expect(demoOrganizationService.unbanMember(target.id)).rejects.toThrow(/not banned/i)
  })
})

describe('who may moderate whom', () => {
  it('refuses self-moderation', async () => {
    const members = await demoOrganizationService.listMembers('any')
    const self = members.find((m) => m.userId === db().currentUserId)!

    await expect(demoOrganizationService.suspendMember(self.id, 'Testing', 7)).rejects.toThrow(
      /your own membership/i,
    )
    await expect(demoOrganizationService.banMember(self.id, 'Testing')).rejects.toThrow(
      /your own membership/i,
    )
  })

  it('refuses to moderate a peer of equal authority', async () => {
    // Two members on the same rank: neither outranks the other.
    const deputy = await demoOrganizationService.createRole('any', {
      name: 'Deputy',
      description: null,
      rank: 100,
    })
    await demoOrganizationService.setRolePermissions(deputy, [
      'organization.view',
      'members.view',
      'members.suspend',
    ])

    const members = await demoOrganizationService.listMembers('any')
    const nonOwners = members.filter((m) => !m.roles.some((r) => r.rank === 0))
    const actor = nonOwners[0]!
    const peer = nonOwners[1]!

    await demoOrganizationService.updateMemberRole(actor.id, deputy)
    await demoOrganizationService.updateMemberRole(peer.id, deputy)

    db().currentUserId = actor.userId
    await expect(demoOrganizationService.suspendMember(peer.id, 'Testing', 7)).rejects.toThrow(
      /at or above your own/i,
    )
  })

  it('refuses moderation without the permission', async () => {
    const bare = await demoOrganizationService.createRole('any', {
      name: 'Bare',
      description: null,
      rank: 100,
    })
    await demoOrganizationService.setRolePermissions(bare, ['organization.view', 'members.view'])

    const members = await demoOrganizationService.listMembers('any')
    const nonOwners = members.filter((m) => !m.roles.some((r) => r.rank === 0))
    const actor = nonOwners[0]!
    const target = nonOwners[1]!
    await demoOrganizationService.updateMemberRole(actor.id, bare)

    db().currentUserId = actor.userId
    await expect(demoOrganizationService.suspendMember(target.id, 'Testing', 7)).rejects.toThrow(
      /permission/i,
    )
  })
})

describe('moderation history', () => {
  it('is append-only across a whole sequence', async () => {
    const target = await someoneOtherThanTheOwner()
    await demoOrganizationService.suspendMember(target.id, 'First', 1)
    await demoOrganizationService.unsuspendMember(target.id)
    await demoOrganizationService.banMember(target.id, 'Second')
    await demoOrganizationService.unbanMember(target.id)

    const history = await demoOrganizationService.listModerationHistory('any', target.userId)
    expect(history.map((h) => h.action)).toEqual(['unban', 'ban', 'unsuspend', 'suspend'])
    // Nothing was overwritten: the earliest reason is still readable.
    expect(history.at(-1)?.reason).toBe('First')
  })

  it('names the actor', async () => {
    const target = await someoneOtherThanTheOwner()
    await demoOrganizationService.suspendMember(target.id, 'Testing', 7)

    const history = await demoOrganizationService.listModerationHistory('any', target.userId)
    expect(history[0]?.actorName).toBeTruthy()
  })
})
