import { Fragment, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Minus, Shield } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CardSkeleton, ErrorState, ForbiddenState } from '@/components/common/states'
import { organizationService } from '@/services/organization.service'
import type { PermissionMatrixRow } from '@/services/organization.service'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { cn } from '@/lib/utils'

/**
 * Read-only view of the permission matrix.
 *
 * Editing roles is possible in the database today — the RLS policies and grants
 * for `roles` and `role_permissions` are in place — but the editing UI is
 * deliberately out of Phase 1 scope. Showing the matrix now means an admin can
 * see exactly what each role grants without guessing from role names.
 */
export function RolesSettings() {
  const { organization } = useWorkspace()
  const canView = usePermission('roles.view')
  const organizationId = organization?.id

  const rolesQuery = useQuery({
    queryKey: queryKeys.roles.all(organizationId ?? 'none'),
    queryFn: () => organizationService.listRoles(organizationId as string),
    enabled: Boolean(organizationId) && canView,
  })

  const matrixQuery = useQuery({
    queryKey: [...queryKeys.permissions.catalog(), organizationId ?? 'none'],
    enabled: Boolean(organizationId) && canView,
    staleTime: 10 * 60_000,
    queryFn: () => organizationService.getPermissionMatrix(organizationId as string),
  })

  const grouped = useMemo(() => {
    const groups = new Map<string, PermissionMatrixRow[]>()
    for (const row of matrixQuery.data ?? []) {
      const bucket = groups.get(row.category) ?? []
      bucket.push(row)
      groups.set(row.category, bucket)
    }
    return [...groups.entries()]
  }, [matrixQuery.data])

  if (!canView) return <ForbiddenState />

  if (rolesQuery.isPending || matrixQuery.isPending) {
    return (
      <Card>
        <CardContent className="pt-4">
          <CardSkeleton lines={10} />
        </CardContent>
      </Card>
    )
  }

  if (rolesQuery.isError || matrixQuery.isError) {
    return (
      <ErrorState
        error={rolesQuery.error ?? matrixQuery.error}
        onRetry={() => {
          void rolesQuery.refetch()
          void matrixQuery.refetch()
        }}
      />
    )
  }

  const roles = rolesQuery.data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Shield className="text-muted-foreground size-3.5" aria-hidden="true" />
          <CardTitle className="flex-1">Roles</CardTitle>
          <Badge variant="outline">{roles.length}</Badge>
        </CardHeader>
        <CardContent>
          <ul className="divide-border divide-y">
            {roles.map((role) => (
              <li key={role.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm leading-tight font-medium">{role.name}</p>
                    {role.isSystem ? <Badge variant="secondary">System</Badge> : null}
                  </div>
                  {role.description ? (
                    <p className="text-2xs text-muted-foreground mt-0.5 leading-relaxed">
                      {role.description}
                    </p>
                  ) : null}
                </div>
                <span className="text-2xs text-muted-foreground shrink-0 font-mono">
                  rank {role.rank}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Permission matrix</CardTitle>
          <p className="text-2xs text-muted-foreground">
            What each role is allowed to do. Enforced by Row Level Security in the database, not by
            the interface.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <caption className="sr-only">Permissions granted to each role</caption>
            <thead>
              <tr className="border-border border-b">
                <th
                  scope="col"
                  className="text-2xs text-muted-foreground py-2 pr-3 font-semibold tracking-wider uppercase"
                >
                  Capability
                </th>
                {roles.map((role) => (
                  <th
                    key={role.id}
                    scope="col"
                    className="text-2xs text-muted-foreground px-2 py-2 text-center font-semibold tracking-wider uppercase"
                  >
                    {role.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map(([category, rows]) => (
                <Fragment key={category}>
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={roles.length + 1}
                      className="text-2xs text-primary/80 pt-4 pb-1 text-left font-semibold tracking-wider uppercase"
                    >
                      {category}
                    </th>
                  </tr>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-border/60 border-b">
                      <th scope="row" className="py-1.5 pr-3 text-xs font-normal">
                        <span className="block leading-tight">{row.label}</span>
                        <span className="text-2xs text-muted-foreground/70 block font-mono">
                          {row.key}
                        </span>
                      </th>
                      {roles.map((role) => {
                        const granted = row.grantedRoleIds.has(role.id)
                        return (
                          <td key={role.id} className="px-2 py-1.5 text-center">
                            {granted ? (
                              <Check
                                className="text-success mx-auto size-3.5"
                                aria-label="Granted"
                              />
                            ) : (
                              <Minus
                                className={cn('text-muted-foreground/30 mx-auto size-3.5')}
                                aria-label="Not granted"
                              />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
