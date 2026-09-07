import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Users } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage, AvatarStatus } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/common/states'
import { displayNameFor, initialsFor } from '@/services/profile.service'
import type { OrganizationMember } from '@/services/organization.service'
import { presenceFrom, presenceLabel } from '@/utils/presence'
import { cn } from '@/lib/utils'

const PRESENCE_ORDER = { online: 0, away: 1, offline: 2 } as const

/**
 * The roster at a glance, and the dashboard's primary panel.
 *
 * Sorted by presence and then by rank, so the answer to "who is about" is the
 * top of the list rather than something to scan for. Ownership is read from
 * the rank the membership already carries — brass marks it, and nothing here
 * decides anything from a role's name.
 */
export function TeamStatusCard({ members }: { members: OrganizationMember[] }) {
  const rows = useMemo(() => {
    const now = Date.now()
    return members
      .filter((member) => member.status === 'active')
      .map((member) => ({ member, presence: presenceFrom(member.profile.lastSeenAt, now) }))
      .sort((a, b) => {
        const byPresence = PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence]
        if (byPresence !== 0) return byPresence
        return a.member.role.rank - b.member.role.rank
      })
  }, [members])

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <CardTitle className="flex-1">Team status</CardTitle>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground -my-2">
          <Link to="/members">
            All members
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No active members yet"
            description="Invite your staff and players to get the roster started."
          />
        ) : (
          <ul className="divide-border-subtle -mx-2 divide-y">
            {rows.map(({ member, presence }) => (
              <li key={member.id} className="flex h-11 items-center gap-3 px-2">
                <span className="relative shrink-0">
                  <Avatar className="size-8 rounded-md">
                    {member.profile.avatarUrl ? (
                      <AvatarImage src={member.profile.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback className="rounded-md">
                      {initialsFor(member.profile)}
                    </AvatarFallback>
                  </Avatar>
                  <AvatarStatus status={presence} />
                </span>

                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <p className="truncate text-sm leading-tight font-semibold">
                    {displayNameFor(member.profile)}
                  </p>
                  {member.profile.title ? (
                    <p className="text-muted-foreground truncate text-xs">{member.profile.title}</p>
                  ) : null}
                </div>

                <Badge variant={member.role.rank === 0 ? 'brass' : 'neutral'}>
                  {member.role.name}
                </Badge>

                {/* Dot and word, so presence is never colour alone. */}
                <span className="flex w-16 shrink-0 items-center justify-end gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 rounded-full',
                      presence === 'online'
                        ? 'bg-success'
                        : presence === 'away'
                          ? 'bg-warning'
                          : 'bg-offline',
                    )}
                  />
                  <span
                    className={cn(
                      'text-2xs',
                      presence === 'offline'
                        ? 'text-muted-foreground'
                        : 'text-secondary-foreground',
                    )}
                  >
                    {presenceLabel(presence)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
