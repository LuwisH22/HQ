import { useState } from 'react'
import { Plus, UsersThree } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Can } from '@/components/common/Can'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState, ErrorState, ForbiddenState, ListSkeleton } from '@/components/common/states'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import type { Team } from '@/services/team.service'
import { TeamRow } from './TeamRow'
import { CreateTeamDialog } from './CreateTeamDialog'
import { useTeamRosters, useTeams } from './use-teams'
import { useTeamsRealtime } from './use-team-realtime'

/**
 * Every team the organization has.
 *
 * Active first, then what has been put away — two groups rather than one
 * sorted list, because "who are we fielding" and "who did we field" are
 * different questions and a single list makes the reader do that sorting.
 * A group with nothing in it is not drawn.
 */
export function TeamsPage() {
  const { organization } = useWorkspace()
  const canView = usePermission('teams.view')
  const canManage = usePermission('teams.manage')
  const [creating, setCreating] = useState(false)

  const query = useTeams(organization?.id, canView)
  const teams = query.data ?? []
  // The faces on each row, in one request rather than one per team.
  const rosters = useTeamRosters(organization?.id, teams)
  // Somebody else creating, renaming, archiving or restoring a team — or
  // changing who is on one — should not need this list to be reopened.
  useTeamsRealtime(organization?.id, canView)

  // The route checks this too. Hiding a navigation row is not access control,
  // and neither is this — the policies are. Both exist so nobody is shown a
  // page made entirely of things they cannot do.
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-4 sm:px-6">
        <ForbiddenState description="Your role does not include access to teams." />
      </div>
    )
  }

  const active = teams.filter((team) => team.archivedAt === null)
  const archived = teams.filter((team) => team.archivedAt !== null)
  const groups: { key: string; label: string; items: Team[] }[] = [
    { key: 'active', label: 'Active', items: active },
    { key: 'archived', label: 'Archived', items: archived },
  ]

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-5 px-4 pt-4 pb-8 sm:px-6 sm:pt-5">
      <PageHeader
        eyebrow="Roster"
        title="Teams"
        description={`The sides and squads at ${organization?.name ?? 'your organization'}.`}
        actions={
          // Hidden rather than disabled, as every permission-gated action in
          // this application is. The routine refuses it either way.
          <Can perm="teams.manage">
            <Button
              onClick={() => {
                setCreating(true)
              }}
            >
              <Plus aria-hidden="true" />
              New team
            </Button>
          </Can>
        }
      />

      {query.isPending ? <ListSkeleton rows={3} /> : null}

      {query.isError ? (
        <ErrorState
          error={query.error}
          onRetry={() => {
            void query.refetch()
          }}
        />
      ) : null}

      {/* Only once the answer is actually in: "no teams" while a request is
          still running is a sentence that turns out to be false. */}
      {!query.isPending && !query.isError && teams.length === 0 ? (
        <EmptyState
          icon={UsersThree}
          title="No teams yet"
          description={
            canManage
              ? 'A team is a group of people here — a starting side, an academy squad, the staff.'
              : 'No teams have been created yet.'
          }
        />
      ) : null}

      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.key} aria-labelledby={`teams-${group.key}`} className="space-y-2">
            <h2
              id={`teams-${group.key}`}
              className="display-eyebrow text-3xs text-muted-foreground"
            >
              {group.label}
            </h2>
            <ul className="space-y-1.5">
              {group.items.map((team) => (
                <TeamRow key={team.id} team={team} roster={rosters.data?.[team.id]} />
              ))}
            </ul>
          </section>
        ))}

      <CreateTeamDialog
        organizationId={organization?.id}
        open={creating}
        onOpenChange={setCreating}
      />
    </div>
  )
}
