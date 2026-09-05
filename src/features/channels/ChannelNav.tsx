import { NavLink } from 'react-router-dom'
import { CaretRight, Hash, LockSimple, ChatTeardropText } from '@phosphor-icons/react'
import { useUiStore } from '@/stores/ui.store'
import { usePermission } from '@/hooks/use-permission'
import { cn } from '@/lib/utils'
import { ChannelCreateMenu } from './ChannelCreateMenu'
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
          'group relative flex min-h-8 items-center gap-2 rounded-sm py-1 pr-2 pl-2 text-sm transition-colors duration-[140ms]',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          isActive
            ? 'bg-primary/14 text-foreground font-medium'
            : unread > 0
              ? // Unread is weight, not colour: the row reads as louder
                // without becoming a second kind of selected.
                'text-foreground hover:bg-foreground/7 font-medium'
              : 'text-muted-foreground hover:bg-foreground/7 hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'bg-primary absolute -left-1.5 h-3.5 w-0.5 rounded-xs transition-opacity',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          {channel.isPrivate ? (
            <LockSimple className="size-3.5 shrink-0 opacity-70" aria-label="Private" />
          ) : (
            <Hash className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
          )}
          <span className="truncate">{channel.name}</span>
          {unread > 0 ? (
            <span
              className="bg-primary/22 text-foreground text-3xs ml-auto min-w-4 rounded-full px-1.5 py-px text-center font-semibold tabular-nums"
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
          'text-3xs text-foreground/42 hover:text-foreground/70 flex w-full items-center gap-1 px-1 py-1 font-semibold tracking-[0.1em] uppercase transition-colors',
          'focus-visible:ring-ring rounded-xs focus-visible:ring-2 focus-visible:outline-none',
        )}
      >
        <CaretRight
          className={cn('size-2.5 transition-transform duration-150', !collapsed && 'rotate-90')}
          aria-hidden="true"
        />
        <span className="truncate">{group.name}</span>
        {collapsed && hidden > 0 ? (
          <span
            className="bg-primary/22 text-foreground text-3xs ml-auto rounded-full px-1.5 py-px font-semibold tabular-nums"
            aria-label={`${String(hidden)} unread`}
          >
            {hidden > 99 ? '99+' : hidden}
          </span>
        ) : (
          <span className="text-foreground/28 ml-auto tabular-nums">{group.channels.length}</span>
        )}
      </button>

      {collapsed ? null : (
        <ul className="mt-0.5 space-y-px pl-1.5">
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
    <div className="flex items-center gap-1 px-1 pt-4 pb-1">
      <p className="text-3xs text-foreground/42 flex-1 font-semibold tracking-[0.1em] uppercase">
        {label}
      </p>
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
            <div key={i} className="bg-foreground/7 h-6 rounded-sm" />
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

      <div className="pt-1.5">
        <NavLink
          to="/channels"
          end
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'text-2xs flex items-center gap-2 rounded-sm px-2 py-1 transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:bg-foreground/7 hover:text-foreground',
            )
          }
        >
          Browse all channels
        </NavLink>
      </div>

      {/* Direct messages have no backend yet (C3). The section exists so the
          shape of the sidebar does not change when they arrive, and says so
          rather than showing an empty list that looks broken. */}
      <SectionHeading label="Direct messages" />
      <p className="text-muted-foreground/70 text-2xs flex items-center gap-2 px-1 leading-relaxed">
        <ChatTeardropText className="size-3.5 shrink-0" aria-hidden="true" />
        Arrives with direct messaging.
      </p>
    </>
  )
}
