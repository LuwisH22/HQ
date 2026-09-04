import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { CardSkeleton, ErrorState } from '@/components/common/states'
import { profileService } from '@/services/profile.service'
import type { Profile } from '@/services/service-contracts'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { COMMON_TIMEZONES } from '@/utils/datetime'
import { profileSchema, type ProfileValues } from '@/features/auth/schemas'

/**
 * The form itself, mounted only once the profile is known.
 *
 * Separating this from the loading state is load-bearing, not cosmetic. Seeding
 * an already-mounted form with async data — whether through `reset()` in an
 * effect or the `values` option — makes the timezone field transition from one
 * value to another after mount, and Radix's Select responds to that transition
 * by clearing the field back to an empty string. The text inputs looked fine,
 * so the bug was invisible until a save wiped the user's timezone.
 *
 * Mounting with the final values in `defaultValues` removes the transition
 * entirely. `ProfileSettings.test.tsx` covers it.
 */
function ProfileForm({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient()

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: profile.displayName ?? '',
      fullName: profile.fullName ?? '',
      title: profile.title ?? '',
      bio: profile.bio ?? '',
      timezone: profile.timezone,
    },
  })

  const mutation = useMutation({
    mutationFn: (values: ProfileValues) =>
      profileService.update({
        displayName: values.displayName,
        fullName: values.fullName || null,
        title: values.title || null,
        bio: values.bio || null,
        timezone: values.timezone,
      }),
    onSuccess: async (updated) => {
      toast.success('Profile updated.')
      queryClient.setQueryData(queryKeys.profile.me(), updated)
      // The roster shows display names and titles, so it is now stale.
      await queryClient.invalidateQueries({ queryKey: ['members'] })
      form.reset({
        displayName: updated.displayName ?? '',
        fullName: updated.fullName ?? '',
        title: updated.title ?? '',
        bio: updated.bio ?? '',
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
      <FormField label="Email" hint="Your sign-in address. Contact an admin to change it.">
        {(props) => <Input {...props} value={profile.email} readOnly disabled />}
      </FormField>

      <FormField
        label="Display name"
        error={form.formState.errors.displayName?.message}
        hint="How you appear across the workspace."
        required
      >
        {(props) => <Input {...props} {...form.register('displayName')} autoComplete="nickname" />}
      </FormField>

      <FormField label="Full name" error={form.formState.errors.fullName?.message}>
        {(props) => <Input {...props} {...form.register('fullName')} autoComplete="name" />}
      </FormField>

      <FormField
        label="Title"
        error={form.formState.errors.title?.message}
        hint="For example: Head Coach, Entry Fragger, Content Producer."
      >
        {(props) => <Input {...props} {...form.register('title')} />}
      </FormField>

      <FormField label="Bio" error={form.formState.errors.bio?.message}>
        {(props) => (
          <textarea
            {...props}
            {...form.register('bio')}
            rows={3}
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring focus-visible:ring-offset-background flex w-full resize-y rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            placeholder="Availability, timezone quirks, anything the team should know."
          />
        )}
      </FormField>

      <FormField
        label="Timezone"
        error={form.formState.errors.timezone?.message}
        hint="Used to show schedules in your local time."
        required
      >
        {(props) => (
          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
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

      <div className="flex justify-end gap-2 pt-1">
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
    </form>
  )
}

export function ProfileSettings() {
  const query = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: () => profileService.getMine(),
  })

  if (query.isPending) {
    return (
      <Card>
        <CardContent className="pt-4">
          <CardSkeleton lines={7} />
        </CardContent>
      </Card>
    )
  }

  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  }

  if (!query.data) {
    return <ErrorState error={new Error('Your profile could not be loaded.')} />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your profile</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Keyed on the record so switching account remounts with fresh values. */}
        <ProfileForm key={query.data.id} profile={query.data} />
      </CardContent>
    </Card>
  )
}
