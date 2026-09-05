import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/common/FormField'
import { CardSkeleton, ErrorState } from '@/components/common/states'
import { displayNameFor, initialsFor, profileService } from '@/services/profile.service'
import type { Profile } from '@/services/service-contracts'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useWorkspace } from '@/hooks/use-workspace'
import { useUiStore } from '@/stores/ui.store'
import { COMMON_TIMEZONES } from '@/utils/datetime'
import { profileSchema, type ProfileValues } from '@/features/auth/schemas'

/**
 * Your own profile, reachable from the sidebar in one click.
 *
 * It used to be a tab inside Settings, which put a personal detail in among
 * the organization's configuration and made changing your own title a
 * navigation exercise. Settings is now the organization's; this is yours.
 *
 * The service beneath is unchanged: the same `profileService.update`, the same
 * row, the same policy. Nothing here can edit anybody else's profile.
 */

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
 * entirely. `ProfileDialog.test.tsx` covers it.
 */
function ProfileForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
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
      className="flex flex-col gap-4 px-5 pt-1 pb-5"
      noValidate
    >
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
          <Textarea
            {...props}
            {...form.register('bio')}
            rows={3}
            className="resize-y"
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
        <Button type="button" variant="ghost" onClick={onDone}>
          Close
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!form.formState.isDirty}>
          Save changes
        </Button>
      </div>
    </form>
  )
}

/** Identity below the title: who you are, and the address you sign in with. */
function ProfileHeader({ profile }: { profile: Profile }) {
  const { membership } = useWorkspace()

  return (
    <div className="flex items-center gap-3 px-5 pt-3 pb-4">
      <Avatar className="size-11">
        {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt="" /> : null}
        <AvatarFallback>{initialsFor(profile)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm leading-tight font-semibold">{displayNameFor(profile)}</p>
        <p className="text-2xs text-muted-foreground mt-0.5 truncate">
          {membership?.role.name ?? 'Member'}
        </p>
        {/* Read-only on purpose: the sign-in address is changed by an
            administrator, not from here. Shown as text rather than a disabled
            field, which is both smaller and less of an invitation. */}
        <p className="text-2xs text-muted-foreground/70 truncate">{profile.email}</p>
      </div>
    </div>
  )
}

export function ProfileDialog() {
  const open = useUiStore((state) => state.profileOpen)
  const setOpen = useUiStore((state) => state.setProfileOpen)

  const query = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: () => profileService.getMine(),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle className="px-5 pt-5">Your profile</DialogTitle>

        {query.isPending ? (
          <div className="px-5 pt-4 pb-5">
            <CardSkeleton lines={6} />
          </div>
        ) : query.isError ? (
          <div className="px-5 pt-4 pb-5">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : !query.data ? (
          <div className="px-5 pt-4 pb-5">
            <ErrorState error={new Error('Your profile could not be loaded.')} />
          </div>
        ) : (
          <>
            <ProfileHeader profile={query.data} />
            {/* Keyed on the record so switching account remounts with fresh
                values rather than reusing the previous person's. */}
            <ProfileForm key={query.data.id} profile={query.data} onDone={() => setOpen(false)} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
