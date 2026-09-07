import { NavLink } from 'react-router-dom'
import { CaretRight, Hash, LockSimple, SpeakerHigh } from '@phosphor-icons/react'
import { useUiStore } from '@/stores/ui.store'
import { usePermission } from '@/hooks/use-permission'
import { cn } from '@/lib/utils'
import { ChannelCreateMenu } from './ChannelCreateMenu'
import { DirectMessageNav } from './DirectMessageNav'
import { useUnreadCounts } from './use-unread'
import { useChannelDirectory, type ChannelGroup } from './use-channels'

/**
 * The channel list, as navigation rather than as a directory.
 *
 * This is the part of the sidebar that makes LFG HQ a place to talk rather
 * than a set of admin screens: every channel the member can see is one click
 * away from wherever they are, and the one they are reading is obvious.
 *
 * Nothing here decides access — the list arrives already scoped by RLS, so a
 * private channel without an explicit ALLOW is absent, not hidden.
 */

/**
 * The channel's own glyph.
 *
 * Selected turns it accent and switches to Phosphor's fill weight, which is
 * the app's one rule for a chosen icon.
 */
function ChannelIcon({
  channel,
  active,
}: {
  channel: ChannelGroup['channels'][number]
  active: boolean
}) {
  const shared = cn('size-[18px] shrink-0', active ? 'text-accent-text' : 'text-muted-foreground')
  const weight = active ? 'fill' : 'regular'

  if (channel.type === 'voice') {
    return (
      <SpeakerHigh
        weight={weight}
        className={shared}
        aria-label={channel.isPrivate ? 'Private voice channel' : 'Voice channel'}
      />
    )
  }
  if (channel.isPrivate) {
    return <LockSimple weight={weight} className={shared} aria-label="Private" />
  }
  return <Hash weight={weight} className={shared} aria-hidden="true" />
}

function ChannelRow({
  channel,
  unread,
  onNavigate,
}: {
  channel: ChannelGroup['channels'][number]
  unread: number
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={`/channels/${channel.key}`}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex h-[30px] items-center gap-2 rounded-sm px-2 text-sm transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
          isActive
            ? 'bg-surface-active text-foreground font-medium'
            : unread > 0
              ? // Unread is weight and a dot, never colour: the row reads as
                // louder without becoming a second kind of selected.
                'text-foreground hover:bg-accent font-semibold'
              : 'text-secondary-foreground hover:bg-accent hover:text-foreground font-medium',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? <span aria-hidden="true" className="nav-rail -left-1.5" /> : null}
          {/* A voice channel says so first: it is the difference that changes
              what clicking does. Private is carried by the label rather than
              by a second glyph, so the row keeps one icon whatever it is. */}
          <ChannelIcon channel={channel} active={isActive} />
          <span className="truncate">{channel.name}</span>
          {unread > 0 ? (
            <span
              className="text-2xs text-foreground ml-auto font-mono tabular-nums"
              aria-label={`${String(unread)} unread`}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  )
}

function CategorySection({
  group,
  unread,
  onNavigate,
}: {
  group: ChannelGroup
  unread: Map<string, number>
  onNavigate?: () => void
}) {
  const collapsed = useUiStore((state) => state.collapsedCategories.includes(group.id))
  const toggleCategory = useUiStore((state) => state.toggleCategory)

  // A folded category still has to say there is something inside it.
  const hidden = group.channels.reduce((sum, c) => sum + (unread.get(c.id) ?? 0), 0)

  return (
    <li>
      <button
        type="button"
        onClick={() => toggleCategory(group.id)}
        aria-expanded={!collapsed}
        className={cn(
          'display-eyebrow text-3xs text-muted-foreground hover:text-secondary-foreground flex h-6 w-full items-center gap-1 rounded-xs px-2 transition-colors duration-[120ms]',
        )}
      >
        <CaretRight
          className={cn(
            'size-3 shrink-0 transition-transform duration-[120ms]',
            !collapsed && 'rotate-90',
          )}
          aria-hidden="true"
        />
        <span className="truncate">{group.name}</span>
        {collapsed && hidden > 0 ? (
          <span
            className="text-2xs text-foreground ml-auto font-mono tracking-normal normal-case tabular-nums"
            aria-label={`${String(hidden)} unread`}
          >
            {hidden > 99 ? '99+' : hidden}
          </span>
        ) : (
          <span className="text-2xs text-muted-foreground/60 ml-auto font-mono tracking-normal normal-case tabular-nums">
            {group.channels.length}
          </span>
        )}
      </button>

      {collapsed ? null : (
        <ul className="space-y-0.5 pl-1.5">
          {group.channels.map((channel) => (
            <li key={channel.id}>
              <ChannelRow
                channel={channel}
                unread={unread.get(channel.id) ?? 0}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** Section heading with an optional trailing action. */
function SectionHeading({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-6 items-center gap-1 px-2 pt-5">
      <p className="display-eyebrow text-3xs text-muted-foreground flex-1">{label}</p>
      {action}
    </div>
  )
}

export function ChannelNav({ onNavigate }: { onNavigate?: () => void }) {
  const canView = usePermission('channels.view')
  const canCreate = usePermission('channels.create')
  const directory = useChannelDirectory()
  const unread = useUnreadCounts()

  if (!canView) return null

  return (
    <>
      {/* Creating happens here rather than in Settings: a channel is made in
          the middle of a conversation about needing one. */}
      <SectionHeading label="Channels" action={<ChannelCreateMenu onNavigate={onNavigate} />} />

      {directory.isPending ? (
        <div className="space-y-1 px-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted h-6 rounded-sm" />
          ))}
        </div>
      ) : directory.navGroups.length === 0 ? (
        <p className="text-muted-foreground text-2xs px-1 leading-relaxed">
          {canCreate ? 'No channels yet. Use + to create one.' : 'No channels you can see yet.'}
        </p>
      ) : (
        <ul className="space-y-1.5" aria-label="Channels">
          {directory.navGroups.map((group) => (
            <CategorySection key={group.id} group={group} unread={unread} onNavigate={onNavigate} />
          ))}
        </ul>
      )}

      {/* The last row of the Channels group rather than a note under it: at
          the same height and indent as a channel, so the space below it reads
          as the end of the section instead of a gap around a stray line. */}
      <div className="mt-1 pl-1.5">
        <NavLink
          to="/channels"
          end
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex h-[30px] items-center gap-2 rounded-sm px-2 text-sm font-medium transition-colors duration-[120ms]',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )
          }
        >
          Browse all channels
        </NavLink>
      </div>

      {/* Its own section, beside the channels rather than inside one: a
          conversation is not a room the organization owns. */}
      <DirectMessageNav onNavigate={onNavigate} />
    </>
  )
}
