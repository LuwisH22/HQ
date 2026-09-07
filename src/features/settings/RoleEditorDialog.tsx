import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Info, LockSimple } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/common/FormField'
import { organizationService } from '@/services/organization.service'
import type { MemberRole, PermissionMatrixRow } from '@/services/organization.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useWorkspace } from '@/hooks/use-workspace'
import type { Permission } from '@/lib/permissions'

/**
 * Create or edit a role, including exactly what it may do.
 *
 * Two rules from the database are mirrored here so the UI cannot offer
 * something the server will refuse:
 *
 *   * hierarchy — a role must sit strictly below the editor's own authority;
 *   * delegation — a permission the editor does not hold cannot be granted.
 *
 * Both are re-checked in Postgres. Greying a checkbox is a courtesy, not the
 * control: `set_role_permissions` refuses the same edit server-side.
 */
export function RoleEditorDialog({
  open,
  onOpenChange,
  role,
  matrix,
  organizationId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null creates a new role. */
  role: MemberRole | null
  matrix: PermissionMatrixRow[]
  organizationId: string
}) {
  const queryClient = useQueryClient()
  const { membership, permissions } = useWorkspace()
  const actorRank = membership?.isOwner ? -1 : (membership?.role.rank ?? 1000)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rank, setRank] = useState(500)
  const [granted, setGranted] = useState<ReadonlySet<string>>(new Set())

  // Re-seed whenever the dialog opens on a different role, so a previous
  // edit never leaks into the next one.
  useEffect(() => {
    if (!open) return
    setName(role?.name ?? '')
    setDescription(role?.description ?? '')
    setRank(role?.rank ?? Math.max(actorRank + 1, 500))
    setGranted(
      new Set(
        role ? matrix.filter((row) => row.grantedRoleIds.has(role.id)).map((row) => row.key) : [],
      ),
    )
  }, [open, role, matrix, actorRank])

  const grouped = useMemo(() => {
    const groups = new Map<string, PermissionMatrixRow[]>()
    for (const row of matrix) {
      groups.set(row.category, [...(groups.get(row.category) ?? []), row])
    }
    return [...groups.entries()]
  }, [matrix])

  const rankTooHigh = rank <= actorRank

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim()
      const desc = description.trim() === '' ? null : description.trim()

      let roleId = role?.id
      if (roleId) {
        await organizationService.updateRole(roleId, trimmed, desc)
        if (role && role.rank !== rank) await organizationService.setRoleRank(roleId, rank)
      } else {
        roleId = await organizationService.createRole(organizationId, {
          name: trimmed,
          description: desc,
          rank,
        })
      }
      await organizationService.setRolePermissions(roleId, [...granted])
    },
    onSuccess: async () => {
      // Roles decide what the whole app offers, so refetch rather than patching
      // the cache optimistically. Correctness beats a frame of latency here.
      await queryClient.invalidateQueries({ queryKey: queryKeys.roles.all(organizationId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.permissions.catalog() })
      await queryClient.invalidateQueries({ queryKey: queryKeys.members.all(organizationId) })
      toast.success(role ? 'Role updated.' : 'Role created.')
      onOpenChange(false)
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  function toggle(key: string, on: boolean): void {
    setGranted((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent centres on the LAYOUT viewport, which on a phone is
          taller than the screen — so a tall dialog hangs off the bottom and
          its footer lands under the overlay, unreachable. On narrow screens
          this anchors to the top instead, where the available height is
          knowable; centring returns at sm and above. */}
      <DialogContent className="top-3 flex max-h-[88dvh] translate-y-0 flex-col gap-0 overflow-hidden overflow-y-hidden p-0 sm:top-1/2 sm:max-h-[85dvh] sm:max-w-2xl sm:-translate-y-1/2">
        <div className="border-border-subtle shrink-0 border-b px-5 py-4">
          <DialogTitle>{role ? `Edit ${role.name}` : 'Create a role'}</DialogTitle>
          <DialogDescription className="mt-1">
            Names are yours to choose and carry no authority of their own. Rank decides who may
            manage whom; permissions decide what the role can do.
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" required>
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Tournament Manager"
                  autoFocus
                />
              )}
            </FormField>

            <FormField
              label="Rank"
              required
              error={rankTooHigh ? 'Must be below your own authority' : undefined}
              hint="Lower means more authority."
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={Math.max(actorRank + 1, 0)}
                  max={1000}
                  value={rank}
                  onChange={(event) => setRank(Number(event.target.value))}
                />
              )}
            </FormField>
          </div>

          <FormField label="Description">
            {(props) => (
              <Input
                {...props}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What is this role for?"
              />
            )}
          </FormField>

          <div className="space-y-4">
            {grouped.map(([category, rows]) => (
              <div key={category}>
                <p className="display-eyebrow text-3xs text-muted-foreground mb-2">{category}</p>
                <div className="space-y-1.5">
                  {rows.map((row) => {
                    const canDelegate = permissions.can(row.key as Permission)
                    const isOn = granted.has(row.key)
                    // Already-granted permissions stay visible and removable
                    // even if the editor cannot delegate them.
                    const locked = !canDelegate && !isOn
                    return (
                      <label
                        key={row.key}
                        className="hover:bg-elevated flex cursor-pointer items-start gap-2.5 rounded-sm px-2 py-1.5 transition-colors duration-[120ms]"
                      >
                        <Checkbox
                          checked={isOn}
                          disabled={locked}
                          onCheckedChange={(next) => toggle(row.key, next === true)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-xs font-medium">
                            {row.label}
                            {locked ? (
                              <LockSimple
                                className="text-muted-foreground size-3"
                                aria-label="You cannot grant this"
                              />
                            ) : null}
                          </span>
                          {row.description ? (
                            <span className="text-muted-foreground text-2xs block">
                              {row.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-border-subtle bg-elevated flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          <p className="text-muted-foreground text-2xs flex items-center gap-1.5">
            <Info className="size-3.5 shrink-0" aria-hidden="true" />
            Locked items are permissions you do not hold yourself.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={mutation.isPending}
              disabled={name.trim().length < 2 || rankTooHigh}
              onClick={() => mutation.mutate()}
            >
              {role ? 'Save changes' : 'Create role'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
