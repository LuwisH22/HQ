import { useState } from 'react'
import { ArrowsLeftRight, PencilSimple, Plus, X } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import type { Team, TeamMember } from '@/services/team.service'
import { displayNameFor, initialsFor } from '@/services/profile.service'
import { ListSkeleton } from '@/components/common/states'
import { handleOf } from './roster-candidates'
import { compareForRoster, ROSTER_STATUS_LABELS, rosterSummary } from './roster-status'
import { AddMemberDialog } from './AddMemberDialog'
import { RemoveMemberDialog } from './RemoveMemberDialog'
import { EditRosterMemberDialog } from './EditRosterMemberDialog'
import { MoveMemberDialog } from './MoveMemberDialog'
import type { useTeamMutations } from './use-teams'

/**
 * Who is on a team.
 *
 * Real people from the organization's own roster: an avatar, the name they are
 * known by and the local part of their address, which is what the member list
 * already shows. No position, no game role, no statistics and no online dot —
 * none of those are columns, and inventing them here would be inventing them
 * about a person.
 *
 * Every control on this panel is gated on `teams.roster_manage` and on nothing
 * else. A coach holds it without holding `teams.manage`, which is the whole
 * reason the catalogue has two permissions, so the roster must not borrow the
 * other one to decide anything.
 *
 * The order is who is playing, then who is not, then who joined first. There
 * is no stored sort and no drag handle: a roster is five to ten people, and a
 * fractional-position column of the kind the task board needs would be
 * machinery for a list that does not need it.
 */
export function TeamRoster({
  team,
  teams,
  members,
  loading,
  canManageRoster,
  mutations,
}: {
  team: Team
  /** Every team here, so somebody can be moved to one of the others. */
  teams: readonly Team[]
  members: readonly TeamMember[]
  loading: boolean
  /** `teams.roster_manage`, and never `teams.manage`. */
  canManageRoster: boolean
  mutations: ReturnType<typeof useTeamMutations>
}) {
  /*
   * Which row a dialog is open for, by id rather than by a copy of the row.
   *
   * A snapshot would go stale the moment somebody else changed that person's
   * position, and would keep a dialog open over somebody who had been taken
   * off the roster entirely. Deriving it from the live query means a realtime
   * refetch updates what the dialog is looking at, and closes it by itself
   * when the person is no longer there.
   *
   * It also leaves an open draft alone: the dialogs fill their fields when the
   * member they are open for changes, and that id does not change underneath
   * somebody who is typing.
   */
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)

  const ordered = [...members].sort(compareForRoster)
  const find = (id: string | null) =>
    id === null ? null : (members.find((one) => one.memberId === id) ?? null)
  const removing = find(removingId)
  const editing = find(editingId)
  const moving = find(movingId)
  const elsewhere = teams.filter((one) => one.id !== team.id && one.archivedAt === null)

  const archived = team.archivedAt !== null
  // An archived team takes no roster changes — the routine refuses them, so
  // nothing is offered that would fail.
  const mayChange = canManageRoster && !archived

  return (
    <section aria-labelledby="team-roster" className="space-y-2.5">
      <div className="flex items-center gap-2">
        <h2 id="team-roster" className="display-eyebrow text-3xs text-muted-foreground">
          Roster
        </h2>
        <span className="text-3xs text-muted-foreground/60 font-mono">
          {rosterSummary(members)}
        </span>

        {mayChange ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-2xs ml-auto h-6"
            onClick={() => {
              setAdding(true)
            }}
          >
            <Plus aria-hidden="true" />
            Add member
          </Button>
        ) : null}
      </div>

      {loading ? <ListSkeleton rows={3} /> : null}

      {!loading && members.length === 0 ? (
        <p className="text-muted-foreground/70 text-xs">
          {archived
            ? 'Nobody was on this team when it was archived.'
            : 'Nobody is on this team yet.'}
        </p>
      ) : null}

      <ul className="space-y-1">
        {ordered.map((member) => (
          <li
            key={member.memberId}
            className="border-border-subtle bg-surface flex items-center gap-2.5 rounded-md border px-2.5 py-2"
          >
            <Avatar className="size-7 shrink-0">
              <AvatarImage src={member.profile.avatarUrl ?? undefined} alt="" />
              <AvatarFallback className="text-[10px]">{initialsFor(member.profile)}</AvatarFallback>
            </Avatar>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">
                {displayNameFor(member.profile)}
              </span>
              <span className="text-3xs text-muted-foreground block truncate font-mono">
                {handleOf(member.profile.email)}
              </span>
              {/*
                What they do and whether they are playing, in words. Never a
                colour on its own: "Substitute" has to be readable to somebody
                who cannot tell one dot from another.
              */}
              <span className="text-3xs text-muted-foreground/70 block truncate">
                {member.position ? `${member.position} · ` : ''}
                {ROSTER_STATUS_LABELS[member.status]}
              </span>
            </span>

            {mayChange ? (
              <span className="flex shrink-0 items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground/50 hover:text-foreground size-6"
                  aria-label={`Edit ${displayNameFor(member.profile)}’s roster details`}
                  onClick={() => {
                    setEditingId(member.memberId)
                  }}
                >
                  <PencilSimple aria-hidden="true" />
                </Button>

                {/* Only when there is somewhere to move them to. */}
                {elsewhere.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground/50 hover:text-foreground size-6"
                    aria-label={`Move ${displayNameFor(member.profile)} to another team`}
                    onClick={() => {
                      setMovingId(member.memberId)
                    }}
                  >
                    <ArrowsLeftRight aria-hidden="true" />
                  </Button>
                ) : null}

                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground/50 hover:text-foreground size-6"
                  aria-label={`Remove ${displayNameFor(member.profile)} from ${team.name}`}
                  onClick={() => {
                    setRemovingId(member.memberId)
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {mayChange ? (
        <AddMemberDialog
          organizationId={team.organizationId}
          teamName={team.name}
          roster={members}
          open={adding}
          onOpenChange={setAdding}
          mutations={mutations}
        />
      ) : null}

      <RemoveMemberDialog
        member={removing}
        teamName={team.name}
        onOpenChange={(open) => {
          if (!open) setRemovingId(null)
        }}
        mutations={mutations}
      />

      <EditRosterMemberDialog
        member={editing}
        teamName={team.name}
        onOpenChange={(open) => {
          if (!open) setEditingId(null)
        }}
        mutations={mutations}
      />

      <MoveMemberDialog
        member={moving}
        team={team}
        teams={teams}
        onOpenChange={(open) => {
          if (!open) setMovingId(null)
        }}
        mutations={mutations}
      />
    </section>
  )
}
