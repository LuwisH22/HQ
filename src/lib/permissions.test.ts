import { describe, expect, it } from 'vitest'
import {
  canActOnRank,
  canGrantRank,
  isPermission,
  OWNER_RANK,
  PermissionSet,
  PERMISSIONS,
} from './permissions'

/**
 * These mirror `tg_guard_member_changes` in
 * `supabase/migrations/20250901000250_authorization.sql`. If that trigger's
 * rules change, these tests should fail — the UI and the database must agree
 * about who may act on whom.
 */

const OWNER = 0
const ADMIN = 10
const MANAGER = 20
const PLAYER = 40

describe('PermissionSet', () => {
  it('reports a granted permission', () => {
    const set = new PermissionSet(['members.view', 'members.invite'])
    expect(set.can('members.view')).toBe(true)
    expect(set.can('members.remove')).toBe(false)
  })

  it('treats an empty set as no access', () => {
    const set = PermissionSet.empty()
    expect(set.size).toBe(0)
    expect(set.can('organization.view')).toBe(false)
    expect(set.canAny(['organization.view', 'members.view'])).toBe(false)
  })

  it('canAny requires at least one match', () => {
    const set = new PermissionSet(['files.view'])
    expect(set.canAny(['files.view', 'files.delete'])).toBe(true)
    expect(set.canAny(['files.delete', 'files.manage'])).toBe(false)
  })

  it('canAll requires every match', () => {
    const set = new PermissionSet(['tasks.view', 'tasks.create'])
    expect(set.canAll(['tasks.view', 'tasks.create'])).toBe(true)
    expect(set.canAll(['tasks.view', 'tasks.assign'])).toBe(false)
  })

  it('ignores keys that are not in the catalogue', () => {
    const set = new PermissionSet(['members.view', 'not.a_permission'])
    expect(set.toArray()).toEqual(['members.view'])
  })

  it('is not mutated by changes to the source iterable', () => {
    const source = ['members.view']
    const set = new PermissionSet(source)
    source.push('organization.delete')
    expect(set.can('organization.delete')).toBe(false)
  })
})

describe('isPermission', () => {
  it('accepts every catalogued key', () => {
    for (const permission of PERMISSIONS) {
      expect(isPermission(permission)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isPermission('members.destroy')).toBe(false)
    expect(isPermission('')).toBe(false)
  })
})

describe('canActOnRank', () => {
  it('lets an owner act on anyone', () => {
    expect(canActOnRank(OWNER, ADMIN)).toBe(true)
    expect(canActOnRank(OWNER, OWNER)).toBe(true)
  })

  it('stops a member acting on an equal rank', () => {
    expect(canActOnRank(ADMIN, ADMIN)).toBe(false)
    expect(canActOnRank(MANAGER, MANAGER)).toBe(false)
  })

  it('stops a member acting on a higher authority', () => {
    expect(canActOnRank(MANAGER, ADMIN)).toBe(false)
    expect(canActOnRank(PLAYER, OWNER)).toBe(false)
  })

  it('allows acting on a lower authority', () => {
    expect(canActOnRank(ADMIN, MANAGER)).toBe(true)
    expect(canActOnRank(MANAGER, PLAYER)).toBe(true)
  })

  it('always allows acting on yourself', () => {
    expect(canActOnRank(PLAYER, PLAYER, { isSelf: true })).toBe(true)
    expect(canActOnRank(ADMIN, ADMIN, { isSelf: true })).toBe(true)
  })

  it('denies when the actor has no membership', () => {
    expect(canActOnRank(null, PLAYER)).toBe(false)
    expect(canActOnRank(undefined, PLAYER)).toBe(false)
    expect(canActOnRank(null, PLAYER, { isSelf: true })).toBe(false)
  })
})

describe('canGrantRank', () => {
  it('permits granting your own rank or below', () => {
    expect(canGrantRank(ADMIN, ADMIN)).toBe(true)
    expect(canGrantRank(ADMIN, PLAYER)).toBe(true)
  })

  it('refuses granting more authority than you hold', () => {
    expect(canGrantRank(MANAGER, ADMIN)).toBe(false)
    expect(canGrantRank(PLAYER, OWNER_RANK)).toBe(false)
  })

  it('lets an owner grant ownership', () => {
    expect(canGrantRank(OWNER_RANK, OWNER_RANK)).toBe(true)
  })

  it('denies when the actor has no membership', () => {
    expect(canGrantRank(null, PLAYER)).toBe(false)
  })
})
