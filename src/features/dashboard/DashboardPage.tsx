import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarClock,
  CheckSquare,
  FolderKanban,
  Mail,
  Shield,
  UserPlus,
  Users,
  Wifi,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { StatTile } from './StatTile'
import { TeamStatusCard } from './TeamStatusCard'
import { ActivityFeedCard } from './ActivityFeedCard'
import { UpcomingPanel } from './UpcomingPanel'

/**
 * The HQ dashboard.
 *
 * Widgets backed by Phase 1 data (roster, presence, invitations, audit trail)
 * show real numbers. Widgets whose data lands in a later phase render an
 * explicit empty state naming what will fill them, rather than placeholder
 * figures that would read as real.
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

  const firstName = profileQuery.data ? displayNameFor(profileQuery.data).split(' ')[0] : undefined

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 sm:p-6">
      {/* --- Greeting --------------------------------------------------- */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-2xs text-muted-foreground font-medium tracking-wider uppercase">
            {formatLongDate(new Date())}
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            {greetingFor()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-muted-foreground text-xs">
            {organization?.name ?? 'Your organization'}
            {membership ? ` · ${membership.role.name}` : ''}
          </p>
        </div>

        <Can perm="members.invite">
          <Button size="sm" asChild>
            <Link to="/members?invite=1">
              <UserPlus aria-hidden="true" />
              Invite member
            </Link>
          </Button>
        </Can>
      </header>

      {/* --- Stat row ---------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Users}
          label="Active members"
          value={canViewMembers ? stats.total : '—'}
          hint={canViewMembers ? 'In this organization' : 'Requires member access'}
          loading={canViewMembers && membersQuery.isPending}
        />
        <StatTile
          icon={Wifi}
          label="Around now"
          value={canViewMembers ? stats.onlineNow : '—'}
          hint="Seen in the last 30 minutes"
          loading={canViewMembers && membersQuery.isPending}
          accent="success"
        />
        <StatTile
          icon={Mail}
          label="Pending invites"
          value={canInvite ? stats.pendingInvites : '—'}
          hint={canInvite ? 'Awaiting acceptance' : 'Requires invite access'}
          loading={canInvite && invitationsQuery.isPending}
        />
        <StatTile
          icon={Shield}
          label="Your role"
          value={membership?.role.name ?? '—'}
          hint={`${membership?.permissions.size ?? 0} permissions granted`}
        />
      </div>

      {/* --- Schedule and work ------------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <UpcomingPanel
          title="Today's schedule"
          icon={CalendarClock}
          description="Scrims, matches, reviews and meetings for today."
          availableInPhase={4}
        />
        <UpcomingPanel
          title="Active projects"
          icon={FolderKanban}
          description="Boards you are a member of, with progress at a glance."
          availableInPhase={3}
        />
        <UpcomingPanel
          title="Your tasks"
          icon={CheckSquare}
          description="Everything assigned to you, sorted by due date."
          availableInPhase={3}
        />
      </div>

      {/* --- Roster and activity ------------------------------------------ */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {!canViewMembers ? (
            <Card>
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
            <Card>
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
            <Card>
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

        <div className="lg:col-span-2">
          <ActivityFeedCard organizationId={organizationId} />
        </div>
      </div>
    </div>
  )
}
