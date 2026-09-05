import { Hash, LockSimple, Microphone, MonitorPlay, PushPin } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { initialsFor } from '@/services/profile.service'
import type { Channel } from '@/services/channel.service'
import type { Message } from '@/services/message.service'
import type { OrganizationMember } from '@/services/organization.service'
import { cn } from '@/lib/utils'

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

const PANEL_WIDTH = 'w-[320px]'

/** Uppercase eyebrow with an optional count beside it. */
function SectionHeading({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-baseline gap-2 px-4 pt-5 pb-2">
      <h2 className="text-3xs text-foreground/42 font-semibold tracking-[0.1em] uppercase">
        {label}
      </h2>
      {count === undefined ? null : (
        <span className="text-3xs text-foreground/30 tabular-nums">{count}</span>
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
      <Icon className="text-muted-foreground/60 mt-px size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs leading-tight font-medium">{label}</p>
        <p className="text-2xs text-muted-foreground/70 mt-0.5 leading-relaxed">{detail}</p>
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
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <SectionHeading label="Channel" />
      <div className="px-4">
        <p className="flex items-center gap-1.5 text-sm leading-tight font-semibold">
          {channel.isPrivate ? (
            <LockSimple className="text-muted-foreground size-3.5 shrink-0" aria-label="Private" />
          ) : (
            <Hash className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
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
        <p className="text-muted-foreground/70 text-2xs px-4 leading-relaxed">
          Nothing pinned yet.
        </p>
      ) : (
        <ul aria-label="Pinned messages" className="px-2">
          {pinned.map((message) => (
            <li key={message.id} className="flex items-start gap-2 rounded-md px-2 py-1.5">
              <PushPin className="text-accent-text mt-px size-3.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs leading-relaxed break-words">{message.body}</p>
                <p className="text-2xs text-muted-foreground/70 truncate">{message.authorName}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionHeading label="Members" count={membersPending ? undefined : members.length} />
      {channel.isPrivate ? (
        // Now the truth rather than a caveat: channel_member_ids resolves this
        // list through the same rules that govern the channel itself.
        <p className="text-2xs text-muted-foreground/70 px-4 pb-1 leading-relaxed">
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
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
              <Avatar className="size-7 shrink-0">
                {member.profile.avatarUrl ? (
                  <AvatarImage src={member.profile.avatarUrl} alt="" />
                ) : null}
                <AvatarFallback>{initialsFor(member.profile)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs leading-tight font-medium">
                  {member.profile.displayName ?? member.profile.fullName ?? member.profile.email}
                </p>
                <p className="text-2xs text-muted-foreground truncate">{member.role.name}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Foundations only. Nothing behind these yet — no voice, no streaming,
          no infrastructure — and they say so rather than looking broken. */}
      <SectionHeading label="Activity" />
      <div className="pb-4">
        <ActivityRow icon={Microphone} label="Voice" detail="No active voice session." />
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
        className={cn('border-border bg-surface/40 h-full border-l', PANEL_WIDTH)}
      >
        {children}
      </aside>
    </div>
  )
}
