import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Archive, ArrowUUpLeft, CaretLeft, PencilSimple } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState, ForbiddenState } from '@/components/common/states'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { formatDate } from '@/utils/datetime'
import { TeamRoster } from './TeamRoster'
import { EditTeamDialog } from './EditTeamDialog'
import { ArchiveTeamDialog } from './ArchiveTeamDialog'
import { useTeam, useTeamMembers, useTeamMutations, useTeams } from './use-teams'
import { useTeamRealtime } from './use-team-realtime'

/**
 * One team.
 *
 * The header is the team — what it is called, what it is for, whether it is
 * still in use — and everything under it is the roster.
 *
 * The two sets of controls come from two permissions and are kept apart on
 * purpose. `teams.manage` draws Edit, Archive and Restore; `teams.roster_manage`
 * draws Add member and Remove. A coach holding only the second gets a page
 * with a working roster and no way to rename or archive the team, which is
 * exactly what the permission catalogue has said since the day it was written.
 */
export function TeamDetailPage() {
  const { teamId } = useParams<{ teamId: string }>()
  const { organization } = useWorkspace()

  const canView = usePermission('teams.view')
  const canManage = usePermission('teams.manage')
  const canManageRoster = usePermission('teams.roster_manage')

  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const query = useTeam(organization?.id, teamId)
  const members = useTeamMembers(organization?.id, teamId, canView)
  // The organization's teams, for moving somebody to one of the others. The
  // list page has usually loaded this already, so it is normally a cache read.
  const teams = useTeams(organization?.id, canView && canManageRoster)
  // One subscription for the page: the team itself and its roster. Losing
  // teams.view closes it rather than merely hiding what it feeds.
  useTeamRealtime(organization?.id, teamId, canView)
  const mutations = useTeamMutations(organization?.id, teamId)

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-4 sm:px-6">
        <ForbiddenState description="Your role does not include access to teams." />
      </div>
    )
  }

  const team = query.data ?? null
  const archived = team?.archivedAt != null

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-5 px-4 pt-4 pb-8 sm:px-6 sm:pt-5">
      <Link
        to="/teams"
        className="text-muted-foreground hover:text-foreground text-2xs inline-flex items-center gap-1 transition-colors"
      >
        <CaretLeft aria-hidden="true" className="size-3" />
        Teams
      </Link>

      {query.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState
          error={query.error}
          onRetry={() => {
            void query.refetch()
          }}
        />
      ) : null}

      {/*
        One sentence for both "no such team" and "not yours to see". A page
        that distinguished them would confirm that a team exists in another
        organization to somebody who cannot see it, which is a thing worth not
        saying.
      */}
      {!query.isPending && !query.isError && !team ? (
        <EmptyState
          title="Team unavailable"
          description="It may have been removed, or it belongs to another organization."
        />
      ) : null}

      {team ? (
        <>
          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="display-eyebrow text-3xs text-muted-foreground flex items-center gap-2">
                  Team
                  {archived ? (
                    <Badge variant="neutral" className="text-3xs">
                      Archived
                    </Badge>
                  ) : null}
                </p>
                <h1 className="mt-1 text-[22px] leading-7 font-semibold tracking-[-0.015em]">
                  {team.name}
                </h1>
              </div>

              {/*
                Team management only. Every control here is `teams.manage`, and
                none of them appears for somebody who merely manages the roster.
              */}
              {canManage ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {!archived ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setEditing(true)
                        }}
                      >
                        <PencilSimple aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setArchiving(true)
                        }}
                      >
                        <Archive aria-hidden="true" />
                        Archive
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={mutations.restore.isPending}
                      onClick={() => {
                        mutations.restore.mutate(undefined, {
                          onSuccess: () => {
                            toast.success('Team restored.')
                          },
                        })
                      }}
                    >
                      <ArrowUUpLeft aria-hidden="true" />
                      Restore team
                    </Button>
                  )}
                </div>
              ) : null}
            </div>

            {team.description ? (
              <p className="text-secondary-foreground max-w-prose text-sm break-words whitespace-pre-wrap">
                {team.description}
              </p>
            ) : null}

            <p className="text-2xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
              <span>Created {formatDate(team.createdAt)}</span>
              {archived && team.archivedAt ? (
                <span>Archived {formatDate(team.archivedAt)}</span>
              ) : null}
            </p>
          </header>

          <TeamRoster
            team={team}
            teams={teams.data ?? []}
            members={members.data ?? []}
            loading={members.isPending}
            canManageRoster={canManageRoster}
            mutations={mutations}
          />

          {canManage ? (
            <>
              <EditTeamDialog
                team={team}
                open={editing}
                onOpenChange={setEditing}
                mutations={mutations}
              />
              <ArchiveTeamDialog
                team={team}
                open={archiving}
                onOpenChange={setArchiving}
                mutations={mutations}
              />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
