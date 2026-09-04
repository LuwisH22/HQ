import { beforeEach, describe, expect, it } from 'vitest'
import { clearDemoCache, db, resetDemoDatabase } from './demo-database'
import { demoChannelService, demoOrganizationService, signInAsDemoAdmin } from './index'

/**
 * Phase 1.5 · B3 — channel access.
 *
 * These carry more weight than usual. The live verification runs as the
 * organization owner, and the owner short-circuits every check by design — so
 * the non-owner matrix (private channels, Deny > Allow > Inherit, moderation,
 * hierarchy) is proved here against a faithful port of `can_in_channel()`.
 */

beforeEach(async () => {
  localStorage.clear()
  clearDemoCache()
  resetDemoDatabase()
  await signInAsDemoAdmin()
})

/**
 * Act as somebody who is not the owner, holding exactly one known role.
 *
 * The seed's non-owner members hold a mixture of roles, and picking whoever
 * comes first makes these tests depend on which one that happens to be — a
 * Manager already holds channels.manage, which quietly defeats the point of
 * several of them. Pinning the role makes each test mean what it says.
 */
async function actAsNonOwner(roleName = 'Player') {
  const members = await demoOrganizationService.listMembers('any')
  const target = members.find((m) => !m.roles.some((r) => r.rank === 0))
  if (!target) throw new Error('no non-owner member in the seed')

  const role = await roleNamed(roleName)
  await demoOrganizationService.updateMemberRole(target.id, role.id)

  db().currentUserId = target.userId
  const refreshed = (await demoOrganizationService.listMembers('any')).find(
    (m) => m.id === target.id,
  )
  return refreshed ?? target
}

async function roleNamed(name: string) {
  const roles = await demoOrganizationService.listRoles('any')
  const role = roles.find((r) => r.name === name)
  if (!role) throw new Error(`no role named ${name}`)
  return role
}

const privateChannel = () => db().channels.find((c) => c.isPrivate)!
const publicChannel = () => db().channels.find((c) => !c.isPrivate)!

describe('private channels', () => {
  it('are visible to the owner, who is never restricted', async () => {
    const channels = await demoChannelService.listChannels('any')
    expect(channels.some((c) => c.isPrivate)).toBe(true)
  })

  it('are invisible to a member with no explicit ALLOW', async () => {
    const secret = privateChannel()
    await actAsNonOwner()

    const channels = await demoChannelService.listChannels('any')
    // Absent, not merely hidden: there is no row to guess the id of.
    expect(channels.some((c) => c.id === secret.id)).toBe(false)
    expect(channels.length).toBeGreaterThan(0)
  })

  it('become visible when a held role is given ALLOW', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()
    const grantedRole = target.role.id

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoChannelService.setOverride(secret.id, grantedRole, 'channels.view', 'allow')

    db().currentUserId = target.userId
    const channels = await demoChannelService.listChannels('any')
    expect(channels.some((c) => c.id === secret.id)).toBe(true)
  })

  it('lose visibility again when the role is removed from the member', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()
    const grantedRole = target.role.id

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoChannelService.setOverride(secret.id, grantedRole, 'channels.view', 'allow')

    // Give them a different role entirely; access should follow the role.
    const staff = await roleNamed('Staff')
    if (staff.id !== grantedRole) {
      await demoOrganizationService.updateMemberRole(target.id, staff.id)
      db().currentUserId = target.userId
      const channels = await demoChannelService.listChannels('any')
      expect(channels.some((c) => c.id === secret.id)).toBe(false)
    }
  })
})

describe('Deny > Allow > Inherit', () => {
  it('inherits the organization answer for a public channel', async () => {
    const open = publicChannel()
    await actAsNonOwner()

    const channels = await demoChannelService.listChannels('any')
    expect(channels.some((c) => c.id === open.id)).toBe(true)
  })

  it('lets DENY remove access to a public channel', async () => {
    const open = publicChannel()
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoChannelService.setOverride(open.id, target.role.id, 'channels.view', 'deny')

    db().currentUserId = target.userId
    const channels = await demoChannelService.listChannels('any')
    expect(channels.some((c) => c.id === open.id)).toBe(false)
  })

  it('lets DENY from one role beat ALLOW from another', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()

    const allowRole = await roleNamed('Player')
    const denyRole = await roleNamed('Staff')

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoOrganizationService.updateMemberRole(target.id, allowRole.id)
    await demoOrganizationService.assignRole(target.id, denyRole.id)
    await demoChannelService.setOverride(secret.id, allowRole.id, 'channels.view', 'allow')
    await demoChannelService.setOverride(secret.id, denyRole.id, 'channels.view', 'deny')

    db().currentUserId = target.userId
    const channels = await demoChannelService.listChannels('any')
    // One DENY among several roles is enough. The safer default.
    expect(channels.some((c) => c.id === secret.id)).toBe(false)
  })

  it('returns to inherit when the override is cleared', async () => {
    const open = publicChannel()
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoChannelService.setOverride(open.id, target.role.id, 'channels.view', 'deny')
    await demoChannelService.setOverride(open.id, target.role.id, 'channels.view', null)

    db().currentUserId = target.userId
    const channels = await demoChannelService.listChannels('any')
    expect(channels.some((c) => c.id === open.id)).toBe(true)
  })
})

describe('overrides are channel-local', () => {
  it('an ALLOW on one channel grants nothing on another', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()

    // A second private channel, with no override at all.
    db().currentUserId = null
    await signInAsDemoAdmin()
    const otherId = await demoChannelService.createChannel('any', {
      name: 'other secret',
      topic: null,
      categoryId: null,
      isPrivate: true,
    })
    await demoChannelService.setOverride(secret.id, target.role.id, 'channels.view', 'allow')

    db().currentUserId = target.userId
    const channels = await demoChannelService.listChannels('any')
    expect(channels.some((c) => c.id === secret.id)).toBe(true)
    expect(channels.some((c) => c.id === otherId)).toBe(false)
  })

  it('an ALLOW does not add an organization-level permission', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoChannelService.setOverride(secret.id, target.role.id, 'messages.moderate', 'allow')

    db().currentUserId = target.userId
    const membership = await demoOrganizationService.getCurrentMembership('any')
    // The channel grant is invisible to the organization-level permission set.
    expect(membership?.permissions.can('messages.moderate')).toBe(false)
  })

  it('refuses to override a permission outside the safe subset', async () => {
    const secret = privateChannel()
    const player = await roleNamed('Player')

    await expect(
      demoChannelService.setOverride(secret.id, player.id, 'organization.delete', 'allow'),
    ).rejects.toThrow(/cannot be overridden/i)
    await expect(
      demoChannelService.setOverride(secret.id, player.id, 'members.ban', 'allow'),
    ).rejects.toThrow(/cannot be overridden/i)
  })
})

describe('moderation is the first gate', () => {
  it('a suspended member sees no channels at all', async () => {
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoOrganizationService.suspendMember(target.id, 'Testing', 7)

    db().currentUserId = target.userId
    expect(await demoChannelService.listChannels('any')).toHaveLength(0)
  })

  it('a banned member sees no channels at all', async () => {
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoOrganizationService.banMember(target.id, 'Testing')

    db().currentUserId = target.userId
    expect(await demoChannelService.listChannels('any')).toHaveLength(0)
  })

  it('an expired suspension restores channel access with nothing written', async () => {
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoOrganizationService.suspendMember(target.id, 'Testing', 1)

    const stored = db().members.find((m) => m.id === target.id)!
    stored.suspendedUntil = new Date(Date.now() - 1000).toISOString()

    db().currentUserId = target.userId
    expect((await demoChannelService.listChannels('any')).length).toBeGreaterThan(0)
    expect(stored.status).toBe('suspended')
  })

  it('a DENY cannot be used to reach a channel a suspension already blocks', async () => {
    const open = publicChannel()
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoChannelService.setOverride(open.id, target.role.id, 'channels.view', 'allow')
    await demoOrganizationService.suspendMember(target.id, 'Testing', 7)

    db().currentUserId = target.userId
    // An ALLOW is evaluated after the moderation gate, never before it.
    expect(await demoChannelService.listChannels('any')).toHaveLength(0)
  })
})

describe('hierarchy and delegation', () => {
  it('refuses to change access for a role at or above the actor', async () => {
    const secret = privateChannel()
    const deputy = await demoOrganizationService.createRole('any', {
      name: 'Deputy',
      description: null,
      rank: 100,
    })
    await demoOrganizationService.setRolePermissions(deputy, [
      'organization.view',
      'members.view',
      'channels.view',
      'channels.manage',
      'channels.permissions_manage',
    ])

    const target = await actAsNonOwner()
    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoOrganizationService.updateMemberRole(target.id, deputy)
    await demoChannelService.setOverride(secret.id, deputy, 'channels.view', 'allow')

    db().currentUserId = target.userId
    const admin = await roleNamed('Admin')

    await expect(
      demoChannelService.setOverride(secret.id, admin.id, 'channels.view', 'deny'),
    ).rejects.toThrow(/below your own authority/i)
  })

  it('refuses to delegate a capability the actor does not hold', async () => {
    const secret = privateChannel()
    const limited = await demoOrganizationService.createRole('any', {
      name: 'Limited',
      description: null,
      rank: 100,
    })
    await demoOrganizationService.setRolePermissions(limited, [
      'organization.view',
      'members.view',
      'channels.view',
      'channels.permissions_manage',
    ])

    const target = await actAsNonOwner()
    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoOrganizationService.updateMemberRole(target.id, limited)
    await demoChannelService.setOverride(secret.id, limited, 'channels.view', 'allow')

    // Deliberately below the actor's rank 100, so the hierarchy rule passes and
    // the delegation rule is the one under test.
    const junior = await demoOrganizationService.createRole('any', {
      name: 'Junior',
      description: null,
      rank: 300,
    })

    db().currentUserId = target.userId

    // They hold no messages.moderate, so they cannot hand it out either.
    await expect(
      demoChannelService.setOverride(secret.id, junior, 'messages.moderate', 'allow'),
    ).rejects.toThrow(/do not hold/i)
  })

  it('refuses channel management without the permission', async () => {
    await actAsNonOwner()
    await expect(
      demoChannelService.createCategory('any', 'Should fail'),
    ).rejects.toThrow(/permission/i)
  })
})

describe('categories', () => {
  it('hides a category whose only channel the member cannot see', async () => {
    await actAsNonOwner()
    const categories = await demoChannelService.listCategories('any')
    const visibleChannels = await demoChannelService.listChannels('any')
    const withContent = new Set(visibleChannels.map((c) => c.categoryId))

    // Every category shown must actually contain something they can reach.
    for (const category of categories) {
      expect(withContent.has(category.id)).toBe(true)
    }
  })

  it('leaves channels in place when a category is deleted', async () => {
    const categories = await demoChannelService.listCategories('any')
    const before = await demoChannelService.listChannels('any')

    await demoChannelService.deleteCategory(categories[0]!.id)

    const after = await demoChannelService.listChannels('any')
    expect(after).toHaveLength(before.length)
    expect(after.filter((c) => c.categoryId === categories[0]!.id)).toHaveLength(0)
  })
})

describe('archive and delete', () => {
  it('archives reversibly', async () => {
    const open = publicChannel()
    await demoChannelService.updateChannel(open.id, { archived: true })
    expect(db().channels.find((c) => c.id === open.id)?.archivedAt).not.toBeNull()

    await demoChannelService.updateChannel(open.id, { archived: false })
    expect(db().channels.find((c) => c.id === open.id)?.archivedAt).toBeNull()
  })

  it('deletes a channel and its overrides together', async () => {
    const secret = privateChannel()
    const player = await roleNamed('Player')
    await demoChannelService.setOverride(secret.id, player.id, 'channels.view', 'allow')

    await demoChannelService.deleteChannel(secret.id)

    expect(db().channels.find((c) => c.id === secret.id)).toBeUndefined()
    expect(db().channelOverrides.filter((o) => o.channelId === secret.id)).toHaveLength(0)
  })
})
