import { useMemo } from 'react'
import { Hash, LockSimple, Microphone, MonitorPlay, PushPin } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage, AvatarStatus } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { initialsFor } from '@/services/profile.service'
import type { Channel } from '@/services/channel.service'
import type { Message } from '@/services/message.service'
import type { OrganizationMember } from '@/services/organization.service'
import { cn } from '@/lib/utils'
import { presenceFrom } from '@/utils/presence'
import { VoiceActivity } from '@/features/voice/VoiceActivity'

/**
 * What a channel is, who is in it, and what is happening in it.
 *
 * A column on a wide screen and a sheet on a phone, but one component either
 * way — the sections below are meant to grow (pinned messages, shared files,
 * voice) without the surrounding layout being renegotiated each time.
 *
 * It renders only inside a channel the caller can already see: the chat page
 * around it does not mount without a channel row, and a channel row only
 * arrives if RLS allowed it. Nothing here re-decides that.
 */

const PANEL_WIDTH = 'w-72'

/** Uppercase eyebrow with an optional count beside it. */
function SectionHeading({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-baseline gap-2 px-4 pt-5 pb-2">
      <h2 className="display-eyebrow text-3xs text-muted-foreground">{label}</h2>
      {count === undefined ? null : (
        <span className="text-2xs text-muted-foreground/70 font-mono tabular-nums">{count}</span>
      )}
    </div>
  )
}

/** A section that has nothing in it yet, and says which phase fills it. */
function ActivityRow({
  icon: Icon,
  label,
  detail,
}: {
  icon: typeof Microphone
  label: string
  detail: string
}) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-1.5">
      <Icon className="text-muted-foreground mt-px size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-medium">{label}</p>
        <p className="text-2xs text-muted-foreground mt-0.5">{detail}</p>
      </div>
    </div>
  )
}

export function ChannelPanelContent({
  channel,
  members,
  membersPending,
  pinned,
  pinnedPending,
}: {
  channel: Channel
  /** The members who can actually see this channel, resolved in Postgres. */
  members: OrganizationMember[]
  membersPending: boolean
  pinned: Message[]
  pinnedPending: boolean
}) {
  // Online first, then the rest in the order they arrived. Presence is the
  // only thing the panel re-orders by; who is in the channel was decided in
  // Postgres and is not re-decided here.
  const roster = useMemo(
    () =>
      [...members].sort((a, b) => {
        const rank = (member: OrganizationMember) =>
          presenceFrom(member.profile.lastSeenAt) === 'offline' ? 1 : 0
        return rank(a) - rank(b)
      }),
    [members],
  )

  // The roster this panel already loaded, keyed by user id: a voice
  // participant is an identity, and this is what puts a face on one.
  const avatars = useMemo(() => {
    const byUser = new Map<string, string | null>()
    for (const member of members) byUser.set(member.userId, member.profile.avatarUrl)
    return byUser
  }, [members])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <SectionHeading label="Channel" />
      <div className="px-4">
        <p className="flex items-center gap-1.5 text-sm leading-tight font-semibold">
          {channel.isPrivate ? (
            <LockSimple className="text-accent-text size-3.5 shrink-0" aria-label="Private" />
          ) : (
            <Hash className="text-accent-text size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{channel.name}</span>
        </p>
        <p className="text-2xs text-muted-foreground mt-1 leading-relaxed">
          {channel.topic ?? 'No topic set for this channel yet.'}
        </p>
      </div>

      <SectionHeading label="Pinned" count={pinnedPending ? undefined : pinned.length} />
      {pinnedPending ? (
        <div className="space-y-2 px-4 py-1" aria-hidden="true">
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      ) : pinned.length === 0 ? (
        <p className="text-muted-foreground text-2xs px-4">Nothing pinned yet.</p>
      ) : (
        <ul aria-label="Pinned messages" className="px-2">
          {pinned.map((message) => (
            <li key={message.id} className="flex items-start gap-2 rounded-sm px-2 py-1.5">
              <PushPin
                weight="fill"
                className="text-brass mt-0.5 size-3 shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-secondary-foreground line-clamp-2 text-xs break-words">
                  {message.body}
                </p>
                <p className="text-2xs text-muted-foreground truncate">{message.authorName}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionHeading label="Members" count={membersPending ? undefined : members.length} />
      {channel.isPrivate ? (
        // Now the truth rather than a caveat: channel_member_ids resolves this
        // list through the same rules that govern the channel itself.
        <p className="text-2xs text-muted-foreground px-4 pb-1">
          Private channel. Only the roles allowed in are listed.
        </p>
      ) : null}

      {membersPending ? (
        <div className="space-y-2 px-4 py-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md" />
          ))}
        </div>
      ) : (
        <ul aria-label="Channel members" className="px-2">
          {roster.map((member) => (
            <li key={member.id} className="flex h-8 items-center gap-2.5 rounded-sm px-2">
              <span className="relative shrink-0">
                <Avatar className="size-6 rounded-sm">
                  {member.profile.avatarUrl ? (
                    <AvatarImage src={member.profile.avatarUrl} alt="" />
                  ) : null}
                  <AvatarFallback className="rounded-sm">
                    {initialsFor(member.profile)}
                  </AvatarFallback>
                </Avatar>
                <AvatarStatus
                  status={presenceFrom(member.profile.lastSeenAt)}
                  className="size-2 border-[1.5px]"
                />
              </span>
              <p className="min-w-0 flex-1 truncate text-xs font-medium">
                {member.profile.displayName ?? member.profile.fullName ?? member.profile.email}
              </p>
              <span className="text-2xs text-muted-foreground shrink-0 truncate">
                {member.role.name}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Voice is real now and says what it can actually see. Streaming is
          still a foundation, and says so rather than looking broken. */}
      <SectionHeading label="Activity" />
      <div className="pb-4">
        {channel.type === 'voice' ? (
          <VoiceActivity channel={channel} avatars={avatars} />
        ) : (
          <ActivityRow
            icon={Microphone}
            label="Voice"
            detail="This is a text channel. Voice lives in voice channels."
          />
        )}
        <ActivityRow icon={MonitorPlay} label="Streaming" detail="No active stream." />
      </div>
    </div>
  )
}

/**
 * The panel as a column, clipped to nothing when closed.
 *
 * The width animates and the contents do not: the inner panel keeps its own
 * width throughout, so collapsing slides it away rather than squeezing every
 * line of it through a narrowing box.
 */
export function ChannelPanelColumn({
  open,
  children,
}: {
  open: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden transition-[width] duration-[240ms] ease-out',
        open ? PANEL_WIDTH : 'w-0',
      )}
      // Hidden from assistive technology as well as from view when closed,
      // rather than staying reachable in a zero-width box.
      aria-hidden={!open}
    >
      <aside
        aria-label="Channel details"
        className={cn('border-border bg-background h-full border-l', PANEL_WIDTH)}
      >
        {children}
      </aside>
    </div>
  )
}
