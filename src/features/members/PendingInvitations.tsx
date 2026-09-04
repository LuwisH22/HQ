import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EnvelopeSimple, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CardSkeleton, ErrorState } from '@/components/common/states'
import { invitationService } from '@/services/invitation.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { formatTimeUntil } from '@/utils/datetime'

/** Outstanding invitations, with the option to revoke one. */
export function PendingInvitations({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.invitations.all(organizationId),
    queryFn: () => invitationService.list(organizationId),
  })

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => invitationService.revoke(invitationId),
    onSuccess: async () => {
      toast.success('Invitation revoked.')
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations.all(organizationId) })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const pending = (query.data ?? []).filter((invitation) => invitation.status === 'pending')

  // Nothing outstanding is the normal state; an empty card would be noise.
  if (!query.isPending && !query.isError && pending.length === 0) return null

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <EnvelopeSimple className="text-muted-foreground size-3.5" aria-hidden="true" />
        <CardTitle className="flex-1">Pending invitations</CardTitle>
        {pending.length > 0 ? <Badge variant="outline">{pending.length}</Badge> : null}
      </CardHeader>

      <CardContent>
        {query.isPending ? (
          <CardSkeleton lines={3} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <ul className="divide-border divide-y">
            {pending.map((invitation) => {
              const expired = new Date(invitation.expiresAt).getTime() < Date.now()
              return (
                <li
                  key={invitation.id}
                  className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm leading-tight">{invitation.email}</p>
                    <p className="text-2xs text-muted-foreground truncate">
                      {invitation.roleName}
                      {invitation.invitedByName ? ` · invited by ${invitation.invitedByName}` : ''}
                      {' · '}
                      {formatTimeUntil(invitation.expiresAt)}
                    </p>
                  </div>

                  {expired ? <Badge variant="warning">Expired</Badge> : null}

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Revoke invitation for ${invitation.email}`}
                    loading={revokeMutation.isPending && revokeMutation.variables === invitation.id}
                    onClick={() => revokeMutation.mutate(invitation.id)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
