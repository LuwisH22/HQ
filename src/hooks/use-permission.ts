import { useCallback } from 'react'
import type { Permission } from '@/lib/permissions'
import { useWorkspace } from './use-workspace'

/**
 * Whether the current member holds a permission.
 *
 * This is presentation only. Every action it gates is independently enforced by
 * an RLS policy, so hiding a button is a courtesy, never the control.
 */
export function usePermission(permission: Permission): boolean {
  const { permissions } = useWorkspace()
  return permissions.can(permission)
}

/** True when the member holds at least one of the permissions. */
export function useAnyPermission(required: readonly Permission[]): boolean {
  const { permissions } = useWorkspace()
  return permissions.canAny(required)
}

/** Imperative check, for event handlers and callbacks. */
export function usePermissionCheck(): (permission: Permission) => boolean {
  const { permissions } = useWorkspace()
  return useCallback((permission: Permission) => permissions.can(permission), [permissions])
}
