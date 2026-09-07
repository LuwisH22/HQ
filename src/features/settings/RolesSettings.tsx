import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Crown, PencilSimple, Plus, Shield, Trash } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CardSkeleton, ErrorState, ForbiddenState } from '@/components/common/states'
import { organizationService } from '@/services/organization.service'
import type { MemberRole, PermissionMatrixRow } from '@/services/organization.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { RoleEditorDialog } from './RoleEditorDialog'

/**
 * Role management.
 *
 * Role names are free text and carry no authority whatsoever — a role called
 * "Owner" grants nothing, and renaming one changes nothing. Two things decide
 * what a member may do: `rank`, which orders authority, and the permissions
 * attached to each role they hold.
 *
 * Ownership is deliberately absent from this screen. It lives on the
 * organization itself, so it survives any rename, reorder or deletion here.
 */
export function RolesSettings() {
  const { organization, membership } = useWorkspace()
  const canView = usePermission('roles.view')
  const canManage = usePermission('roles.manage')
  const organizationId = organization?.id
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState<MemberRole | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  // -1 for the owner, so every role sits below them.
  const actorRank = membership?.isOwner ? -1 : (membership?.role.rank ?? 1000)

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => organizationService.deleteRole(roleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.roles.all(organizationId ?? '') })
      await queryClient.invalidateQueries({ queryKey: queryKeys.permissions.catalog() })
      toast.success('Role deleted.')
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

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
        <CardHeader className="border-border-subtle flex-row items-center gap-2 space-y-0 border-b">
          <Shield className="text-muted-foreground size-4" aria-hidden="true" />
          <CardTitle className="flex-1 text-[15px]">Roles</CardTitle>
          <span className="text-2xs text-muted-foreground font-mono tabular-nums">
            {roles.length}
          </span>
          {canManage ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setEditorOpen(true)
              }}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New role
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="pt-2">
          <ul className="divide-border-subtle -mx-2 divide-y" aria-label="Roles">
            {roles.map((role) => {
              // You may only manage roles strictly below your own authority.
              // Postgres enforces the same rule; this only hides what would fail.
              const manageable = canManage && role.rank > actorRank
              return (
                <li key={role.id} className="group/role flex min-h-11 items-center gap-3 px-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm leading-tight font-semibold">{role.name}</p>
                      {role.isSystem ? <Badge variant="neutral">Provisioned</Badge> : null}
                    </div>
                    {role.description ? (
                      <p className="text-2xs text-muted-foreground mt-0.5 truncate">
                        {role.description}
                      </p>
                    ) : null}
                  </div>
                  {/* Rank is the authority, and it is a number: mono, so a
                      column of them lines up and reads as an ordering. */}
                  <span className="text-2xs text-muted-foreground shrink-0 font-mono tabular-nums">
                    rank {role.rank}
                  </span>
                  {manageable ? (
                    <div className="flex shrink-0 gap-0.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Edit ${role.name}`}
                        onClick={() => {
                          setEditing(role)
                          setEditorOpen(true)
                        }}
                      >
                        <PencilSimple aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${role.name}`}
                        loading={deleteMutation.isPending && deleteMutation.variables === role.id}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete the role "${role.name}"? Members who hold no other role must be reassigned first.`,
                            )
                          ) {
                            deleteMutation.mutate(role.id)
                          }
                        }}
                      >
                        <Trash aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <p className="text-2xs text-muted-foreground mt-3 flex items-start gap-1.5 leading-relaxed">
            <Crown className="text-brass mt-0.5 size-3 shrink-0" aria-hidden="true" />
            Ownership is a property of the organization, not of a role. Renaming or deleting a role
            never changes who owns this workspace.
          </p>
        </CardContent>
      </Card>

      {organizationId ? (
        <RoleEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          role={editing}
          matrix={matrixQuery.data ?? []}
          organizationId={organizationId}
        />
      ) : null}

      <Card>
        <CardHeader className="border-border-subtle border-b">
          <CardTitle className="text-[15px]">Permission matrix</CardTitle>
          <p className="text-muted-foreground text-sm">
            What each role is allowed to do. Enforced by Row Level Security in the database, not by
            the interface.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-4">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <caption className="sr-only">Permissions granted to each role</caption>
            <thead>
              <tr className="border-border border-b">
                <th
                  scope="col"
                  className="display-eyebrow text-3xs text-muted-foreground py-2 pr-3"
                >
                  Capability
                </th>
                {roles.map((role) => (
                  <th
                    key={role.id}
                    scope="col"
                    className="display-eyebrow text-3xs text-muted-foreground px-2 py-2 text-center"
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
                      className="display-eyebrow text-3xs text-secondary-foreground pt-4 pb-1 text-left"
                    >
                      {category}
                    </th>
                  </tr>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-border-subtle border-b">
                      <th scope="row" className="py-2 pr-3 text-xs font-normal">
                        <span className="text-secondary-foreground block leading-tight">
                          {row.label}
                        </span>
                        <span className="text-2xs text-muted-foreground block font-mono">
                          {row.key}
                        </span>
                      </th>
                      {roles.map((role) => {
                        const granted = row.grantedRoleIds.has(role.id)
                        return (
                          <td key={role.id} className="px-2 py-1.5 text-center">
                            {granted ? (
                              <Check
                                weight="bold"
                                className="text-accent-text mx-auto size-3.5"
                                aria-label="Granted"
                              />
                            ) : (
                              <>
                                {/* A dash rather than nothing: an empty cell
                                    is ambiguous about whether the row loaded. */}
                                <span aria-hidden="true" className="text-muted-foreground/50">
                                  –
                                </span>
                                <span className="sr-only">Not granted</span>
                              </>
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
