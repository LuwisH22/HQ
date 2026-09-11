import { useQuery } from '@tanstack/react-query'
import { Bell, CalendarBlank, Clock, MapPin, User } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { organizationService } from '@/services/organization.service'
import { displayNameFor } from '@/services/profile.service'
import type { CalendarEvent } from '@/services/calendar.service'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { formatTimestamp } from '@/utils/datetime'
import { cn } from '@/lib/utils'
import { REMINDER_LABELS, reminderValueOf } from './event-form'
import { allDayLength, clockIn, dayTitle, dayKeyOf, durationLabel } from './calendar-time'

/**
 * One event, in the panel.
 *
 * Read-only: the two actions live in the panel's footer, and only where
 * `calendar.manage`, or authorship plus `calendar.create`, would let the
 * database accept them. Hidden rather than disabled, as every other
 * permission-gated action in this application is.
 *
 * The zone the event was written in is shown only when it differs from the
 * zone this reader is in — otherwise it is noise on every row. Everything
 * quieter than that — who added it, when it was last touched — is a group at
 * the bottom that opens on request.
 *
 * `changed` names the parts somebody else just altered, so a person looking
 * at an event that moves under them sees where it moved.
 */
export function EventDetailPanel({
  event,
  displayZone,
  changed = false,
}: {
  event: CalendarEvent
  displayZone: string
  /** A realtime update just replaced this event's values. */
  changed?: boolean
}) {
  const { organization } = useWorkspace()
  const canViewMembers = usePermission('members.view')

  // The roster the app already caches: an event carries a user id, and this is
  // what turns it into a name. Absent permission simply leaves it as nothing.
  const membersQuery = useQuery({
    queryKey: queryKeys.members.all(organization?.id ?? 'none'),
    queryFn: () => organizationService.listMembers(organization?.id as string),
    enabled: Boolean(organization?.id) && canViewMembers,
    staleTime: 5 * 60_000,
  })
  const author = event.createdBy
    ? (membersQuery.data ?? []).find((member) => member.userId === event.createdBy)
    : undefined

  // An all-day event is a day in its own zone; a timed one is an instant, read
  // in the zone this reader keeps.
  const zone = event.allDay ? event.timezone : displayZone
  const startDay = dayKeyOf(event.startsAt, zone)
  const days = allDayLength(event.startsAt, event.endsAt)
  const elsewhere = !event.allDay && event.timezone !== displayZone
  const flash = changed ? 'calendar-changed rounded-xs -mx-1 px-1' : ''

  return (
    <div className="space-y-4">
      <div className={cn('space-y-1', flash)}>
        <Row icon={CalendarBlank} label={dayTitle(startDay, zone)}>
          {event.allDay ? (
            <Badge variant="neutral">{days === 1 ? 'All day' : `${String(days)} days`}</Badge>
          ) : null}
        </Row>
        {event.allDay ? null : (
          <Row
            icon={Clock}
            label={`${clockIn(event.startsAt, displayZone)} – ${clockIn(event.endsAt, displayZone)}`}
          >
            <span className="text-2xs text-muted-foreground font-mono">
              {durationLabel(event.startsAt, event.endsAt)}
            </span>
          </Row>
        )}
        {/* Only when it matters: the hour somebody else meant. */}
        {elsewhere ? (
          <p className="text-2xs text-muted-foreground pl-6 font-mono">
            {clockIn(event.startsAt, event.timezone)} in {event.timezone}
          </p>
        ) : null}
      </div>

      <dl className="space-y-3.5">
        <Field label="Location">
          {event.location ? (
            <span
              className={cn(
                'bg-elevated border-border inline-flex h-6 max-w-full items-center gap-1.5 rounded-sm border px-2 text-xs',
                flash,
              )}
            >
              <MapPin className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{event.location}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Field>

        {/* Whoever scheduled it is who hears about it, which is what the form
            says as well. */}
        <Field label="Reminder">
          {event.reminderMinutes === null ? (
            <span className="text-muted-foreground">No reminder</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Bell className="text-muted-foreground size-3.5" aria-hidden="true" />
              {REMINDER_LABELS[reminderValueOf(event.reminderMinutes)]}
            </span>
          )}
        </Field>

        <Field label="Description">
          {event.description ? (
            <p className={cn('text-secondary-foreground break-words whitespace-pre-wrap', flash)}>
              {event.description}
            </p>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Field>
      </dl>

      <details className="border-border-subtle group border-t pt-3">
        <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1.5 text-xs [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className="border-y-4 border-l-4 border-y-transparent border-l-current transition-transform duration-[120ms] group-open:rotate-90"
          />
          Details
        </summary>
        <dl className="mt-3 space-y-3">
          <Field label="Timezone">
            <span className="font-mono text-xs">{event.timezone}</span>
          </Field>
          {author ? (
            <Field label="Added by">
              <span className="inline-flex items-center gap-1.5">
                <User className="text-muted-foreground size-3.5" aria-hidden="true" />
                {displayNameFor(author.profile)}
              </span>
            </Field>
          ) : null}
          <Field label="Added">
            <span className="font-mono text-xs">{formatTimestamp(event.createdAt)}</span>
          </Field>
          {event.updatedAt !== event.createdAt ? (
            <Field label="Last edited">
              <span className="font-mono text-xs">{formatTimestamp(event.updatedAt)}</span>
            </Field>
          ) : null}
        </dl>
      </details>
    </div>
  )
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CalendarBlank
  label: string
  children?: React.ReactNode
}) {
  return (
    <p className="flex items-center gap-2 text-sm">
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {children}
    </p>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  )
}
