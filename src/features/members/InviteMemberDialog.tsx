import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/common/FormField'
import { invitationService } from '@/services/invitation.service'
import type { MemberRole } from '@/services/organization.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { canGrantRank } from '@/lib/permissions'
import { useWorkspace } from '@/hooks/use-workspace'
import { inviteSchema, type InviteValues } from '@/features/auth/schemas'

/**
 * Sends an invitation through the `invite-user` Edge Function.
 *
 * The role list is trimmed to what the inviter may actually grant. The same
 * rule is enforced inside `create_invitation`, so a tampered request fails in
 * Postgres rather than here.
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
  const actorRank = membership?.role.rank

  const grantableRoles = roles.filter((role) => canGrantRank(actorRank, role.rank))
  const defaultRole = grantableRoles.find((role) => role.key === 'player') ?? grantableRoles[0]

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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            They will receive an email with a link to set a password and join. The link expires in
            seven days and only works for this address.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4"
          noValidate
        >
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

          <FormField
            label="Role"
            error={form.formState.errors.roleId?.message}
            hint="You can only assign roles at or below your own level."
            required
          >
            {(props) => (
              <Controller
                control={form.control}
                name="roleId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                      <SelectValue placeholder="Pick a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {grantableRoles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </FormField>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
