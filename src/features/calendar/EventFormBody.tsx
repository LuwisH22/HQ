import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormFailure } from '@/components/common/FormFailure'
import type { CalendarEvent } from '@/services/calendar.service'
import { defaultsFor, defaultsFromEvent, eventFormSchema, type EventFormValues } from './event-form'
import type { DraftSeed } from './calendar-workspace-state'
import { EventFormFields } from './EventFormFields'

/**
 * The event form, inside the panel.
 *
 * Creating and editing ask for the same things and validate them the same
 * way; what differs is where the values come from and which routine the
 * page calls on submit. The buttons are in the panel's footer, wired to this
 * form by id, so the form itself is only fields.
 *
 * The form opens in the event's own zone. Editing a Jakarta scrim from Berlin
 * shows 20:00 Asia/Jakarta, so saving a change of title cannot quietly move
 * the event by seven hours. The three inputs — date, clock, zone — only
 * become an instant at the moment of submission.
 *
 * Dirtiness is reported upward rather than kept here, because the workspace
 * is what has to refuse to leave while there is unsaved typing.
 *
 * A realtime update to the event being edited does not touch the fields: the
 * person keeps what they typed and is told the event changed. `reloadToken`
 * is how they ask for the new values.
 */
export function EventFormBody({
  formId,
  mode,
  event,
  seed,
  timezone,
  error,
  reloadToken = 0,
  onSubmit,
  onDirtyChange,
}: {
  formId: string
  mode: 'create' | 'edit'
  /** The event being edited. */
  event?: CalendarEvent
  /** Where a new event lands, and at what hour. */
  seed?: DraftSeed
  /** The calendar's own zone: the default for a new event and an option on the picker. */
  timezone: string
  error: unknown
  reloadToken?: number
  onSubmit: (values: EventFormValues) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const defaults = useMemo<EventFormValues>(() => {
    if (mode === 'edit' && event) return defaultsFromEvent(event)
    const day = seed?.day ?? event?.startsAt.slice(0, 10) ?? ''
    const base = defaultsFor(day, timezone)
    return {
      ...base,
      startTime: seed?.startTime ?? base.startTime,
      endTime: seed?.endTime ?? base.endTime,
    }
    // Only a different event, day or explicit reload should refill the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, event?.id, seed?.day, seed?.startTime, seed?.endTime, timezone, reloadToken])

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: defaults,
  })

  useEffect(() => {
    form.reset(defaults)
    // `form` is stable; resetting on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults])

  const dirty = form.formState.isDirty
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  return (
    <form
      id={formId}
      noValidate
      onSubmit={form.handleSubmit((values) => {
        onSubmit(values)
      })}
      className="space-y-4"
    >
      <FormFailure error={error} />
      <EventFormFields form={form} timezone={timezone} autoFocus />
    </form>
  )
}
