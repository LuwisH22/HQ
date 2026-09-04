import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Info, UserPlus } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/common/FormField'
import { invitationService } from '@/services/invitation.service'
import type { MemberRole } from '@/services/organization.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { canGrantRank } from '@/lib/permissions'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'
import { inviteSchema, type InviteValues } from '@/features/auth/schemas'

/**
 * Sends an invitation through the `invite-user` Edge Function.
 *
 * The role list is trimmed to what the inviter may actually grant. The same
 * rule is enforced inside `create_invitation`, so a tampered request fails in
 * Postgres rather than here.
 *
 * Role is a chip group rather than a select: with six roles whose differences
 * matter, showing them all at once — and the selected one's description live
 * underneath — beats hiding them behind a closed menu. This is a control
 * change only; the form still holds a single `roleId` string exactly as the
 * select did.
 */
export function InviteMemberDialog({
  open,
  onOpenChange,
  organizationId,
  roles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  roles: MemberRole[]
}) {
  const queryClient = useQueryClient()
  const { membership } = useWorkspace()
  // The owner outranks every role; otherwise authority is the most
  // authoritative role held. Mirrors my_role_rank() in Postgres.
  const actorRank = membership?.isOwner ? -1 : membership?.role.rank

  const grantableRoles = roles.filter((role) => canGrantRank(actorRank, role.rank))

  // Default to the LEAST authoritative role that may be granted, found by rank
  // rather than by name. Keying this off a role called "player" assumed a role
  // set the organization is free to rename or delete outright, and it also
  // meant the default silently became the most powerful grantable role the
  // moment that name changed.
  const defaultRole = grantableRoles.reduce<MemberRole | undefined>(
    (weakest, role) => (weakest === undefined || role.rank > weakest.rank ? role : weakest),
    undefined,
  )

  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', roleId: defaultRole?.id ?? '' },
  })

  // The role list arrives asynchronously; seed the default once it does.
  useEffect(() => {
    if (open && defaultRole && !form.getValues('roleId')) {
      form.setValue('roleId', defaultRole.id)
    }
  }, [open, defaultRole, form])

  const selectedRoleId = form.watch('roleId')
  const selectedRole = grantableRoles.find((role) => role.id === selectedRoleId)

  const mutation = useMutation({
    mutationFn: (values: InviteValues) =>
      invitationService.create({
        organizationId,
        email: values.email,
        roleId: values.roleId,
      }),
    onSuccess: async (invitation) => {
      toast.success(`Invitation sent to ${invitation.email}.`)
      form.reset({ email: '', roleId: defaultRole?.id ?? '' })
      onOpenChange(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invitations.all(organizationId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.audit.recent(organizationId, 12) }),
      ])
    },
    onError: (error) => {
      form.setError('email', { message: errorMessage(error) })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose={false}>
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
          {/* Header band */}
          <div className="flex gap-3 px-5 pt-5 pb-4">
            <span className="border-primary flex size-8 shrink-0 items-center justify-center rounded-sm border">
              <UserPlus className="text-primary size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle>Invite a member</DialogTitle>
              <DialogDescription className="mt-1">
                They get an email with a link to set a password and join. It expires in seven days
                and only works for this address.
              </DialogDescription>
            </div>
          </div>

          {/* Body band */}
          <div className="flex flex-col gap-[18px] px-5 pt-1 pb-5">
            <FormField label="Email address" error={form.formState.errors.email?.message} required>
              {(props) => (
                <Input
                  {...props}
                  {...form.register('email')}
                  type="email"
                  autoComplete="off"
                  placeholder="name@organization.gg"
                />
              )}
            </FormField>

            <Controller
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <fieldset className="min-w-0 border-0 p-0">
                  <legend className="text-foreground mb-1.5 text-xs font-medium">
                    Role
                    <span className="text-destructive ml-0.5" aria-hidden="true">
                      *
                    </span>
                  </legend>

                  <div className="flex flex-wrap gap-1.5">
                    {grantableRoles.map((role) => {
                      const selected = role.id === field.value
                      return (
                        <button
                          key={role.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => field.onChange(role.id)}
                          className={cn(
                            'rounded-sm border px-[11px] py-[5px] text-xs transition-all duration-[140ms]',
                            selected
                              ? 'border-primary bg-primary/14 text-foreground font-medium'
                              : 'border-border text-muted-foreground hover:bg-foreground/7',
                          )}
                        >
                          {role.name}
                        </button>
                      )
                    })}
                  </div>

                  {/* The selected role's own description, straight from the
                      role catalogue — so the choice explains itself. */}
                  {selectedRole?.description ? (
                    <p className="text-muted-foreground text-2xs mt-2 flex gap-1.5 leading-relaxed">
                      <Info className="mt-px size-3 shrink-0" aria-hidden="true" />
                      {selectedRole.description}
                    </p>
                  ) : null}

                  {form.formState.errors.roleId ? (
                    <p role="alert" className="text-destructive text-2xs mt-2 font-medium">
                      {form.formState.errors.roleId.message}
                    </p>
                  ) : null}
                </fieldset>
              )}
            />
          </div>

          {/* Footer band */}
          <div className="border-border bg-elevated/40 flex items-center gap-3 border-t px-5 py-3.5">
            <p className="text-foreground/45 text-3xs min-w-0 flex-1">
              You can only assign roles at or below your own.
            </p>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Send invitation
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
