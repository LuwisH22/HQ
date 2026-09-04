/**
 * The permission vocabulary, mirrored from `supabase/migrations`.
 *
 * These constants exist so the UI can *hide* what a member cannot do. They are
 * not the security boundary: every one of these keys is enforced again by an
 * RLS policy or a SECURITY DEFINER routine in Postgres. Removing this file
 * would make the app confusing, not insecure.
 */

export const PERMISSIONS = [
  'organization.view',
  'organization.manage',
  'organization.delete',

  'members.view',
  'members.invite',
  'members.manage',
  'members.remove',
  'members.suspend',
  'members.ban',
  'members.unban',

  'roles.view',
  'roles.manage',
  'audit.read',

  'channels.view',
  'channels.create',
  'channels.manage',
  'channels.delete',
  'channels.permissions_manage',
  'messages.send',
  'messages.pin',
  'messages.moderate',

  'projects.view',
  'projects.create',
  'projects.manage',
  'projects.delete',
  'tasks.view',
  'tasks.create',
  'tasks.assign',
  'tasks.manage',

  'calendar.view',
  'calendar.create',
  'calendar.manage',

  'teams.view',
  'teams.manage',
  'teams.roster_manage',

  'files.view',
  'files.upload',
  'files.manage',
  'files.delete',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS)

/** Narrows an arbitrary string from the database to a known permission key. */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value)
}

/**
 * A member's resolved capabilities. Built once per organization and passed
 * around, so no component ever re-derives authorization from a role name.
 */
export class PermissionSet {
  private readonly granted: ReadonlySet<string>

  constructor(granted: Iterable<string>) {
    this.granted = new Set(granted)
  }

  static empty(): PermissionSet {
    return new PermissionSet([])
  }

  /** Does the member hold this exact permission? */
  can(permission: Permission): boolean {
    return this.granted.has(permission)
  }

  /** Does the member hold *at least one* of these? Use for "can see the page". */
  canAny(permissions: readonly Permission[]): boolean {
    return permissions.some((permission) => this.granted.has(permission))
  }

  /** Does the member hold *all* of these? Use for compound actions. */
  canAll(permissions: readonly Permission[]): boolean {
    return permissions.every((permission) => this.granted.has(permission))
  }

  get size(): number {
    return this.granted.size
  }

  toArray(): Permission[] {
    return PERMISSIONS.filter((permission) => this.granted.has(permission))
  }
}

// --- Role ranks ------------------------------------------------------------

/**
 * Authority ordering, mirroring `roles.rank`. Lower means more authority.
 * Kept here only so the UI can grey out impossible actions; the guard trigger
 * in Postgres is what actually prevents privilege escalation.
 */
export const OWNER_RANK = 0

/**
 * Whether `actorRank` may act on a member holding `targetRank`.
 * Mirrors `tg_guard_member_changes`.
 */
export function canActOnRank(
  actorRank: number | null | undefined,
  targetRank: number,
  options: { isSelf?: boolean } = {},
): boolean {
  if (actorRank == null) return false
  if (options.isSelf) return true
  if (actorRank === OWNER_RANK) return true
  return targetRank > actorRank
}

/** Whether `actorRank` may grant a role of `roleRank`. Mirrors the same guard. */
export function canGrantRank(actorRank: number | null | undefined, roleRank: number): boolean {
  if (actorRank == null) return false
  return roleRank >= actorRank
}
