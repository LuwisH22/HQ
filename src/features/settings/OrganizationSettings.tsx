import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/common/FormField'
import { ForbiddenState } from '@/components/common/states'
import { organizationService } from '@/services/organization.service'
import type { OrganizationSummary } from '@/services/service-contracts'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { COMMON_TIMEZONES } from '@/utils/datetime'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { organizationSchema, type OrganizationValues } from '@/features/auth/schemas'

/**
 * Mounted only once the organization is loaded, and keyed on its id.
 *
 * Same reasoning as `ProfileDialog`: seeding an already-mounted form with
 * async data makes the timezone Select transition after mount, which clears it.
 * Mounting with the final values avoids the problem rather than patching it.
 */
function OrganizationForm({
  organization,
  canManage,
}: {
  organization: OrganizationSummary
  canManage: boolean
}) {
  const queryClient = useQueryClient()

  const form = useForm<OrganizationValues>({
    resolver: zodResolver(organizationSchema),
    defaultValues: {
      name: organization.name,
      tagline: organization.tagline ?? '',
      timezone: organization.timezone,
    },
  })

  const mutation = useMutation({
    mutationFn: (values: OrganizationValues) =>
      organizationService.updateOrganization(organization.id, {
        name: values.name,
        tagline: values.tagline || null,
        timezone: values.timezone,
      }),
    onSuccess: async (updated) => {
      toast.success('Organization updated.')
      await queryClient.invalidateQueries({ queryKey: queryKeys.organizations.mine() })
      form.reset({
        name: updated.name,
        tagline: updated.tagline ?? '',
        timezone: updated.timezone,
      })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      className="space-y-4"
      noValidate
    >
      <FormField
        label="Handle"
        hint="The permanent identifier for this organization. It cannot be changed."
      >
        {(props) => (
          <Input
            {...props}
            value={`@${organization.slug}`}
            readOnly
            disabled
            className="font-mono"
          />
        )}
      </FormField>

      <FormField label="Name" error={form.formState.errors.name?.message} required>
        {(props) => <Input {...props} {...form.register('name')} disabled={!canManage} />}
      </FormField>

      <FormField
        label="Tagline"
        error={form.formState.errors.tagline?.message}
        hint="Shown under the organization name in the sidebar."
      >
        {(props) => <Input {...props} {...form.register('tagline')} disabled={!canManage} />}
      </FormField>

      <FormField
        label="Default timezone"
        error={form.formState.errors.timezone?.message}
        hint="The baseline for scrim and match schedules."
        required
      >
        {(props) => (
          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={!canManage}>
                <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                  <SelectValue placeholder="Pick a timezone" />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </FormField>

      {canManage ? (
        <div className="border-border-subtle mt-1 flex justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => form.reset()}
            disabled={!form.formState.isDirty || mutation.isPending}
          >
            Discard
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!form.formState.isDirty}>
            Save changes
          </Button>
        </div>
      ) : (
        <p className="text-2xs text-muted-foreground">
          You can view these settings but not change them.
        </p>
      )}
    </form>
  )
}

export function OrganizationSettings() {
  const { organization } = useWorkspace()
  const canView = usePermission('organization.view')
  const canManage = usePermission('organization.manage')

  if (!canView) return <ForbiddenState />
  if (!organization) return null

  return (
    <Card>
      <CardHeader className="border-border-subtle border-b">
        <CardTitle className="text-[15px]">Organization</CardTitle>
        <p className="text-muted-foreground text-sm">
          The name, handle and default timezone everything else is scheduled against.
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        <OrganizationForm key={organization.id} organization={organization} canManage={canManage} />
      </CardContent>
    </Card>
  )
}
