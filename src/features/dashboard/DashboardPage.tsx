import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { UserPlus, Users } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Can } from '@/components/common/Can'
import { CardSkeleton, EmptyState, ErrorState } from '@/components/common/states'
import { organizationService } from '@/services/organization.service'
import { invitationService } from '@/services/invitation.service'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { formatLongDate, greetingFor } from '@/utils/datetime'
import { presenceFrom } from '@/utils/presence'
import { displayNameFor, profileService } from '@/services/profile.service'
import { StatRibbon, type Stat } from './StatRibbon'
import { TeamStatusCard } from './TeamStatusCard'
import { ActivityFeedCard } from './ActivityFeedCard'

/**
 * The HQ dashboard.
 *
 * It answers "what is happening in my organization right now" in the first
 * screen, out of data that actually exists: the roster, presence derived from
 * the heartbeat, pending invitations and the audit trail.
 *
 * Nothing here describes the roadmap. A panel for a module that has not
 * shipped is not a preview, it is a dashboard telling you what it cannot do —
 * so those panels are gone, and they come back as real ones.
 */
export function DashboardPage() {
  const { organization, membership } = useWorkspace()
  const canViewMembers = usePermission('members.view')
  const canInvite = usePermission('members.invite')

  const organizationId = organization?.id

  const profileQuery = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: () => profileService.getMine(),
    staleTime: 5 * 60_000,
  })

  const membersQuery = useQuery({
    queryKey: queryKeys.members.all(organizationId ?? 'none'),
    queryFn: () => organizationService.listMembers(organizationId as string),
    enabled: Boolean(organizationId) && canViewMembers,
  })

  const invitationsQuery = useQuery({
    queryKey: queryKeys.invitations.all(organizationId ?? 'none'),
    queryFn: () => invitationService.list(organizationId as string),
    enabled: Boolean(organizationId) && canInvite,
  })

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data])

  const stats = useMemo(() => {
    const now = Date.now()
    const active = members.filter((member) => member.status === 'active')
    const onlineNow = active.filter(
      (member) => presenceFrom(member.profile.lastSeenAt, now) !== 'offline',
    ).length
    const pendingInvites = (invitationsQuery.data ?? []).filter(
      (invite) => invite.status === 'pending',
    ).length

    return { total: active.length, onlineNow, pendingInvites }
  }, [members, invitationsQuery.data])

  const ribbon: Stat[] = [
    {
      label: 'Active',
      value: canViewMembers ? stats.total : '—',
      hint: canViewMembers ? 'In this organization' : 'Requires member access',
      loading: canViewMembers && membersQuery.isPending,
    },
    {
      label: 'Around now',
      value: canViewMembers ? stats.onlineNow : '—',
      hint: 'Seen in the last 30 minutes',
      loading: canViewMembers && membersQuery.isPending,
    },
    {
      label: 'Pending',
      value: canInvite ? stats.pendingInvites : '—',
      hint: canInvite ? 'Awaiting acceptance' : 'Requires invite access',
      loading: canInvite && invitationsQuery.isPending,
    },
    {
      label: 'Your role',
      value: membership?.role.name ?? '—',
      hint: `${String(membership?.permissions.size ?? 0)} permissions granted`,
    },
  ]

  const firstName = profileQuery.data ? displayNameFor(profileQuery.data).split(' ')[0] : undefined
  // Ownership comes from the rank the membership already carries, which is
  // what the roster and the permission system read. Nothing here decides it.
  const isOwner = membership?.role.rank === 0

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-6 px-4 pt-4 pb-8 sm:px-6 sm:pt-5">
      {/* --- Greeting ----------------------------------------------------
          The only display-size text on the page. Everything below it is UI
          scale, which is what makes it read as the top of the page without
          a rule or a card around it. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="display-eyebrow text-3xs text-muted-foreground">
            {formatLongDate(new Date())}
          </p>
          <h1 className="font-display mt-1.5 text-[26px] leading-8 font-semibold tracking-[-0.015em]">
            {greetingFor()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
            <span className="truncate">{organization?.name ?? 'Your organization'}</span>
            {membership ? (
              <>
                <span aria-hidden="true">·</span>
                {isOwner ? (
                  <Badge variant="brass">{membership.role.name}</Badge>
                ) : (
                  <span>{membership.role.name}</span>
                )}
              </>
            ) : null}
          </p>
        </div>

        <Can perm="members.invite">
          <Button asChild>
            <Link to="/members?invite=1">
              <UserPlus aria-hidden="true" />
              Invite member
            </Link>
          </Button>
        </Can>
      </header>

      <StatRibbon stats={ribbon} />

      {/* --- The roster, and what has been happening to it ---------------- */}
      <div className="grid items-start gap-3 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {!canViewMembers ? (
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Team status</CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState
                  icon={Users}
                  title="Not available for your role"
                  description="Ask an admin if you need to see the member directory."
                />
              </CardContent>
            </Card>
          ) : membersQuery.isError ? (
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Team status</CardTitle>
              </CardHeader>
              <CardContent>
                <ErrorState
                  error={membersQuery.error}
                  onRetry={() => void membersQuery.refetch()}
                />
              </CardContent>
            </Card>
          ) : membersQuery.isPending ? (
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Team status</CardTitle>
              </CardHeader>
              <CardContent>
                <CardSkeleton lines={5} />
              </CardContent>
            </Card>
          ) : (
            <TeamStatusCard members={members} />
          )}
        </div>

        <div className="lg:col-span-5">
          <ActivityFeedCard organizationId={organizationId} />
        </div>
      </div>
    </div>
  )
}
