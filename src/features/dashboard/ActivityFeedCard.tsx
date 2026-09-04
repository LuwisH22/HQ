import { useQuery } from '@tanstack/react-query'
import { Pulse } from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CardSkeleton, EmptyState, ErrorState } from '@/components/common/states'
import { auditService } from '@/services/audit.service'
import { queryKeys } from '@/lib/query-keys'
import { usePermission } from '@/hooks/use-permission'
import { displayNameFor } from '@/services/profile.service'
import { formatRelative } from '@/utils/datetime'

const FEED_LIMIT = 12

/**
 * Recent administrative activity, read from the audit log.
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
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <Pulse className="text-muted-foreground size-3.5" aria-hidden="true" />
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
          <ol className="space-y-3">
            {query.data.map((entry) => (
              <li key={entry.id} className="flex gap-2.5">
                <span
                  className="bg-primary/60 mt-1.5 size-1.5 shrink-0 rounded-full"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-snug">
                    {entry.summary ?? entry.action.replace(/[._]/g, ' ')}
                  </p>
                  <p className="text-2xs text-muted-foreground mt-0.5">
                    {entry.actor ? displayNameFor(entry.actor) : 'System'} ·{' '}
                    <time dateTime={entry.createdAt}>{formatRelative(entry.createdAt)}</time>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
