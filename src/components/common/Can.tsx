import type { Permission } from '@/lib/permissions'
import { useWorkspace } from '@/hooks/use-workspace'

interface CanProps {
  /** Render children only if the member holds this permission. */
  perm?: Permission
  /** …or at least one of these. */
  any?: readonly Permission[]
  /** …or all of these. */
  all?: readonly Permission[]
  /** Shown instead when the check fails. Defaults to nothing. */
  fallback?: React.ReactNode
  children: React.ReactNode
}

/**
 * Declarative permission gate.
 *
 * Exists so components never branch on a role name — swapping a role's
 * permissions in the database changes the UI with no code change. This hides
 * affordances; RLS is what actually denies the action.
 */
export function Can({ perm, any, all, fallback = null, children }: CanProps) {
  const { permissions } = useWorkspace()

  const allowed =
    (perm ? permissions.can(perm) : true) &&
    (any ? permissions.canAny(any) : true) &&
    (all ? permissions.canAll(all) : true)

  return <>{allowed ? children : fallback}</>
}
