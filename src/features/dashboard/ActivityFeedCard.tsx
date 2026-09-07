import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pulse } from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CardSkeleton, EmptyState, ErrorState } from '@/components/common/states'
import { auditService } from '@/services/audit.service'
import type { AuditEntry } from '@/services/audit.service'
import { queryKeys } from '@/lib/query-keys'
import { usePermission } from '@/hooks/use-permission'
import { displayNameFor } from '@/services/profile.service'
import { formatDayLabel, formatClock } from '@/utils/datetime'

const FEED_LIMIT = 12

/**
 * Recent administrative activity, read from the audit log.
 *
 * A timeline rather than a list of bullets: the time sits in its own mono
 * column at the left, the thing that happened is primary, and who did it is
 * secondary underneath. Days are separated by a hairline with the date on it,
 * the way the chat transcript separates them.
 *
 * Gated on `audit.read`. RLS returns nothing to a member without it, so this
 * check only decides whether to spend a request — the data is protected either
 * way.
 */
export function ActivityFeedCard({ organizationId }: { organizationId: string | undefined }) {
  const canRead = usePermission('audit.read')

  const query = useQuery({
    queryKey: queryKeys.audit.recent(organizationId ?? 'none', FEED_LIMIT),
    queryFn: () => auditService.listRecent(organizationId as string, FEED_LIMIT),
    enabled: Boolean(organizationId) && canRead,
  })

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>

      <CardContent>
        {!canRead ? (
          <EmptyState
            icon={Pulse}
            title="Not available for your role"
            description="The audit trail is visible to administrators."
          />
        ) : query.isPending ? (
          <CardSkeleton lines={6} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data.length === 0 ? (
          <EmptyState
            icon={Pulse}
            title="Nothing yet"
            description="Administrative changes — invitations, role updates, settings — appear here."
          />
        ) : (
          <ol className="space-y-2.5">
            {query.data.map((entry, index) => (
              <Fragment key={entry.id}>
                {startsANewDay(entry, query.data[index - 1]) ? (
                  <li className="flex items-center gap-2.5 pt-1.5 first:pt-0" aria-hidden="true">
                    <span className="text-2xs text-muted-foreground shrink-0 font-mono">
                      {formatDayLabel(entry.createdAt)}
                    </span>
                    <span className="border-border-subtle flex-1 border-t" />
                  </li>
                ) : null}

                <li className="flex gap-3">
                  <time
                    dateTime={entry.createdAt}
                    className="text-2xs text-muted-foreground w-9 shrink-0 pt-px font-mono tabular-nums"
                  >
                    {formatClock(entry.createdAt)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-xs leading-snug">
                      {entry.summary ?? entry.action.replace(/[._]/g, ' ')}
                    </p>
                    <p className="text-2xs text-secondary-foreground mt-0.5 truncate">
                      {entry.actor ? displayNameFor(entry.actor) : 'System'}
                    </p>
                  </div>
                </li>
              </Fragment>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

/** Whether this entry opens a day the one before it did not belong to. */
function startsANewDay(entry: AuditEntry, previous: AuditEntry | undefined): boolean {
  if (!previous) return true
  return new Date(entry.createdAt).toDateString() !== new Date(previous.createdAt).toDateString()
}
