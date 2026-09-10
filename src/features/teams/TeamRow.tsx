import { Link } from 'react-router-dom'
import { Archive, CaretRight } from '@phosphor-icons/react'
import { AvatarStack, type StackedPerson } from '@/components/common/AvatarStack'
import type { Team, TeamMember } from '@/services/team.service'
import { displayNameFor } from '@/services/profile.service'
import { cn } from '@/lib/utils'
import { ROSTER_STATUS_LABELS, compareForRoster, rosterSummaryFor } from './roster-status'

/**
 * One team, as a row rather than a card.
 *
 * A list of teams is a list: a card grid turns six things into a wall and
 * makes the seventh look like a gap. The row answers what a person asks in
 * order — what is it, who is on it, and how many that is.
 *
 * Nothing about a game, a region, a logo, a rank or a record: none of those
 * are columns, and a row that showed them would be making them up.
 */
export function TeamRow({
  team,
  roster,
}: {
  team: Team
  /** The first few faces, when they have been loaded. */
  roster: readonly TeamMember[] | undefined
}) {
  const archived = team.archivedAt !== null

  // Who is playing comes first, so the faces on the row are the side rather
  // than whoever happened to be added first.
  const people: StackedPerson[] = [...(roster ?? [])].sort(compareForRoster).map((member) => ({
    id: member.memberId,
    name: displayNameFor(member.profile),
    avatarUrl: member.profile.avatarUrl,
    // On hover: what they do, and whether they are starting.
    detail: member.position
      ? `${member.position} · ${ROSTER_STATUS_LABELS[member.status]}`
      : ROSTER_STATUS_LABELS[member.status],
  }))

  return (
    <li>
      <Link
        to={`/teams/${team.id}`}
        className={cn(
          'group border-border-subtle bg-surface hover:border-border-strong hover:bg-elevated',
          'flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-[120ms]',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          archived ? 'opacity-70' : '',
        )}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="truncate text-sm font-medium">{team.name}</p>
            {/*
              A word, not only a dimming: archived is a state somebody has to
              be able to read, including with the colours turned off.
            */}
            {archived ? (
              <span className="display-eyebrow text-3xs text-muted-foreground/70 inline-flex shrink-0 items-center gap-1">
                <Archive aria-hidden="true" className="size-3" />
                Archived
              </span>
            ) : null}
          </div>

          {team.description ? (
            <p className="text-2xs text-muted-foreground line-clamp-1 break-words">
              {team.description}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <AvatarStack people={people} summaryLabel="Roster" emptyLabel="No members yet" />
            {/*
              How many, and how many of those are playing — the second half
              only when it says something the first does not.
            */}
            <p className="text-3xs text-muted-foreground/70 font-mono">
              {rosterSummaryFor(team.memberCount, roster)}
            </p>
          </div>
        </div>

        <CaretRight
          className="text-muted-foreground/50 group-hover:text-muted-foreground mt-1 size-3.5 shrink-0 transition-colors"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}
