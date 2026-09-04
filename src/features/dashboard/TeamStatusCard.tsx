import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Users } from 'lucide-react'
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

/** Roster with derived presence, most-recently-active first. */
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
        <Users className="text-muted-foreground size-3.5" aria-hidden="true" />
        <CardTitle className="flex-1">Team status</CardTitle>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground -my-1">
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
          <ul className="divide-border divide-y">
            {rows.map(({ member, presence }) => (
              <li key={member.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <span className="relative shrink-0">
                  <Avatar>
                    {member.profile.avatarUrl ? (
                      <AvatarImage src={member.profile.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback>{initialsFor(member.profile)}</AvatarFallback>
                  </Avatar>
                  <AvatarStatus status={presence} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm leading-tight font-medium">
                    {displayNameFor(member.profile)}
                  </p>
                  <p className="text-2xs text-muted-foreground truncate">
                    {member.profile.title ?? member.role.name}
                  </p>
                </div>

                <Badge variant={member.role.rank === 0 ? 'default' : 'outline'}>
                  {member.role.name}
                </Badge>

                <span
                  className={cn(
                    'text-2xs w-14 shrink-0 text-right',
                    presence === 'online' ? 'text-success' : 'text-muted-foreground',
                  )}
                >
                  {presenceLabel(presence)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
