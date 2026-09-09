import { Controller, type UseFormReturn } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/common/FormField'
import { COMMON_TIMEZONES } from '@/utils/datetime'
import { EVENT_TYPE_LABELS } from './event-types'
import { EVENT_TYPES, REMINDER_LABELS, REMINDER_VALUES, type EventFormValues } from './event-form'

/**
 * The fields an event has, wherever it is being written.
 *
 * Creating and editing ask for exactly the same things and validate them in
 * exactly the same way, so they share the fields rather than keeping two
 * copies that drift. What differs between the two dialogs is the title, the
 * verb on the button and which routine is called — not the form.
 */
export function EventFormFields({
  form,
  timezone,
  autoFocus = false,
}: {
  form: UseFormReturn<EventFormValues>
  /** The calendar's own zone, offered alongside the curated few. */
  timezone: string
  autoFocus?: boolean
}) {
  const allDay = form.watch('allDay')
  const zone = form.watch('timezone')

  return (
    <>
      <FormField label="Title" error={form.formState.errors.title?.message} required>
        {(props) => (
          <Input
            {...props}
            {...form.register('title')}
            autoFocus={autoFocus}
            placeholder="Scrim vs RRQ"
            maxLength={120}
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Type" error={form.formState.errors.eventType?.message} required>
          {(props) => (
            <Controller
              control={form.control}
              name="eventType"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {EVENT_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
        </FormField>

        <FormField
          label="Timezone"
          error={form.formState.errors.timezone?.message}
          hint="The hour this event is meant in."
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
                    {/* Neither the zone the calendar is read in nor the one
                          this event was written in need be among the curated
                          few, so both are offered. Without the second, editing
                          a Jakarta scrim would open on an empty picker. */}
                    {[...new Set([zone, timezone, ...COMMON_TIMEZONES])].map((option) => (
                      <SelectItem key={option} value={option}>
                        {option.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
        </FormField>
      </div>

      {/* All day changes what the two rows below mean, so it sits above
            them rather than beside the times. */}
      <Controller
        control={form.control}
        name="allDay"
        render={({ field }) => (
          <label className="border-border-subtle bg-background flex cursor-pointer items-center gap-2.5 rounded-sm border px-3 py-2.5">
            <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="All day" />
            <span className="min-w-0">
              <span className="block text-xs font-medium">All day</span>
              <span className="text-2xs text-muted-foreground block">
                Whole days in {zone}, with no clock time.
              </span>
            </span>
          </label>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={allDay ? 'First day' : 'Starts'}
          error={
            form.formState.errors.startDate?.message ?? form.formState.errors.startTime?.message
          }
          required
        >
          {(props) => (
            <div className="flex gap-2">
              <Input
                {...props}
                type="date"
                {...form.register('startDate')}
                className="min-w-0 flex-1 font-mono"
              />
              {allDay ? null : (
                <Input
                  type="time"
                  aria-label="Start time"
                  {...form.register('startTime')}
                  className="w-[104px] shrink-0 font-mono"
                />
              )}
            </div>
          )}
        </FormField>

        <FormField
          label={allDay ? 'Last day' : 'Ends'}
          error={form.formState.errors.endDate?.message ?? form.formState.errors.endTime?.message}
          required
        >
          {(props) => (
            <div className="flex gap-2">
              <Input
                {...props}
                type="date"
                {...form.register('endDate')}
                className="min-w-0 flex-1 font-mono"
              />
              {allDay ? null : (
                <Input
                  type="time"
                  aria-label="End time"
                  {...form.register('endTime')}
                  className="w-[104px] shrink-0 font-mono"
                />
              )}
            </div>
          )}
        </FormField>
      </div>

      <FormField
        label="Reminder"
        error={form.formState.errors.reminder?.message}
        hint="Only you are reminded — whoever schedules an event is who hears about it."
      >
        {(props) => (
          <Controller
            control={form.control}
            name="reminder"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_VALUES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {REMINDER_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </FormField>

      <FormField label="Location" error={form.formState.errors.location?.message}>
        {(props) => (
          <Input
            {...props}
            {...form.register('location')}
            placeholder="Practice room, Discord, the arena"
            maxLength={200}
          />
        )}
      </FormField>

      <FormField label="Description" error={form.formState.errors.description?.message}>
        {(props) => (
          <Textarea
            {...props}
            {...form.register('description')}
            rows={3}
            className="resize-y"
            maxLength={2000}
            placeholder="What it is for, who is expected, anything the team should know."
          />
        )}
      </FormField>
    </>
  )
}
