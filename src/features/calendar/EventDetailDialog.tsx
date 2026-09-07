import { useQuery } from '@tanstack/react-query'
import { CalendarBlank, Clock, MapPin, User } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { organizationService } from '@/services/organization.service'
import { displayNameFor } from '@/services/profile.service'
import type { CalendarEvent } from '@/services/calendar.service'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { formatTimestamp } from '@/utils/datetime'
import { EVENT_TYPE_LABELS } from './event-types'
import { allDayLength, clockIn, dayTitle, dayKeyOf, durationLabel } from './calendar-time'

/**
 * One event, read-only.
 *
 * Phase 5.2 shows what is scheduled; changing it belongs to the phase that
 * builds the form. There is deliberately no edit or delete control here rather
 * than a disabled one, because a disabled button is a promise with a date on
 * it.
 *
 * The zone the event was written in is shown only when it differs from the
 * zone this reader is in — otherwise it is noise on every row.
 */
export function EventDetailDialog({
  event,
  displayZone,
  onClose,
}: {
  event: CalendarEvent | null
  displayZone: string
  onClose: () => void
}) {
  const { organization } = useWorkspace()
  const canViewMembers = usePermission('members.view')

  // The roster the app already caches: an event carries a user id, and this is
  // what turns it into a name. Absent permission simply leaves it as nothing.
  const membersQuery = useQuery({
    queryKey: queryKeys.members.all(organization?.id ?? 'none'),
    queryFn: () => organizationService.listMembers(organization?.id as string),
    enabled: Boolean(organization?.id) && canViewMembers && Boolean(event),
    staleTime: 5 * 60_000,
  })

  const author = event?.createdBy
    ? (membersQuery.data ?? []).find((member) => member.userId === event.createdBy)
    : undefined

  return (
    <Dialog open={event !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        {event ? <Body event={event} displayZone={displayZone} author={author?.profile} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function Body({
  event,
  displayZone,
  author,
}: {
  event: CalendarEvent
  displayZone: string
  author: Parameters<typeof displayNameFor>[0] | undefined
}) {
  // An all-day event is a day in its own zone; a timed one is an instant, read
  // in the zone this reader keeps.
  const zone = event.allDay ? event.timezone : displayZone
  const startDay = dayKeyOf(event.startsAt, zone)
  const days = allDayLength(event.startsAt, event.endsAt)
  const elsewhere = !event.allDay && event.timezone !== displayZone

  return (
    <>
      <div className="px-5 pt-5 pb-3.5">
        <p className="display-eyebrow text-3xs text-muted-foreground">
          {EVENT_TYPE_LABELS[event.eventType]}
        </p>
        <DialogTitle className="mt-1 text-[15px]">{event.title}</DialogTitle>
      </div>

      <div className="border-border-subtle bg-background space-y-2.5 border-y px-5 py-3.5">
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

        {event.location ? <Row icon={MapPin} label={event.location} /> : null}
        {author ? <Row icon={User} label={displayNameFor(author)} /> : null}
      </div>

      <div className="space-y-3 px-5 py-4">
        {event.description ? (
          <p className="text-secondary-foreground text-sm break-words whitespace-pre-wrap">
            {event.description}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">No description.</p>
        )}

        <p className="text-2xs text-muted-foreground font-mono">
          Added {formatTimestamp(event.createdAt)}
          {event.updatedAt !== event.createdAt
            ? ` · edited ${formatTimestamp(event.updatedAt)}`
            : ''}
        </p>
      </div>
    </>
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
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </p>
  )
}
