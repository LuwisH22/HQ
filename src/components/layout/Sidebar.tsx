import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import { CaretDoubleLeft, CaretDoubleRight } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChannelNav } from '@/features/channels/ChannelNav'
import { useWorkspace } from '@/hooks/use-workspace'
import { useUiStore } from '@/stores/ui.store'
import { cn } from '@/lib/utils'
import { NAV_ITEMS, type NavItem } from './navigation'
import { OrganizationSwitcher } from './OrganizationSwitcher'
import { VoiceSessionBar } from '@/features/voice/VoiceSessionBar'
import { ProfileButton, SignOutButton } from './UserMenu'

/**
 * One navigation row, 30px tall.
 *
 * Selection is three things at once and none of them is weight: the row takes
 * the accent-tinted surface, the icon turns accent and switches to Phosphor's
 * fill weight, and the blade appears in the sidebar's gutter. Weight is
 * reserved for unread, which is a state rather than a place.
 */
function NavRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const link = (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }) =>
        cn(
          'group relative flex h-[30px] items-center gap-2 rounded-sm px-2 text-sm font-medium transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-surface-active text-foreground'
            : 'text-secondary-foreground hover:bg-accent hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? <span aria-hidden="true" className="nav-rail" /> : null}
          <item.icon
            weight={isActive ? 'fill' : 'regular'}
            className={cn(
              'size-[18px] shrink-0',
              isActive ? 'text-accent-text' : 'text-muted-foreground',
            )}
            aria-hidden="true"
          />
          {collapsed ? (
            <span className="sr-only">{item.label}</span>
          ) : (
            <span className="truncate">{item.label}</span>
          )}
        </>
      )}
    </NavLink>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Primary desktop navigation, and the channel list with it.
 *
 * The channels are here rather than behind a directory page because talking is
 * what the product is for: the conversation should be one click from wherever
 * you are, and the one you are reading should be obvious without going back to
 * a list to check.
 *
 * Items the member has no permission for are removed rather than disabled —
 * showing a player a greyed-out "Manage roles" entry tells them about a door
 * they can never open.
 */
export function Sidebar() {
  const { permissions } = useWorkspace()
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)

  // The navigation lists what the organization can do today. A module that
  // has not shipped is not a row with a label on it — it is absent, and it
  // appears the day it works.
  const visibleItems = useMemo(
    () =>
      NAV_ITEMS.filter(
        (item) => item.shipped && (item.requires.length === 0 || permissions.canAny(item.requires)),
      ),
    [permissions],
  )

  const primaryItems = visibleItems.filter((item) => item.group === 'primary')
  const organizationItems = visibleItems.filter((item) => item.group === 'organization')
  // Collapsed to icons there is no room for a channel list, so the directory
  // link stands in for it rather than the channels becoming unreachable.
  const chatItems = visibleItems.filter((item) => item.group === 'chat')

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'bg-sidebar flex h-full shrink-0 flex-col transition-[width] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)]',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <OrganizationSwitcher collapsed={collapsed} />

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-0.5">
          {primaryItems.map((item) => (
            <li key={item.id}>
              <NavRow item={item} collapsed={collapsed} />
            </li>
          ))}
          {collapsed
            ? chatItems.map((item) => (
                <li key={item.id}>
                  <NavRow item={item} collapsed />
                </li>
              ))
            : null}
        </ul>

        {collapsed ? null : <ChannelNav />}

        {organizationItems.length > 0 ? (
          <>
            {!collapsed ? (
              <p className="display-eyebrow text-3xs text-muted-foreground flex h-6 items-center px-2 pt-5">
                Organization
              </p>
            ) : (
              <div className="border-border-subtle my-3 border-t" aria-hidden="true" />
            )}
            <ul className="space-y-0.5">
              {organizationItems.map((item) => (
                <li key={item.id}>
                  <NavRow item={item} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </nav>

      {/* The call, if there is one. Above the footer rather than in the
          channel list: it is where you are, not where you might go. */}
      <VoiceSessionBar />

      {/* Who you are, and — once you reach for them — what you can do about
          it. The actions used to sit out in the open, which made a sign-out
          button the loudest thing in the sidebar. */}
      <div
        className={cn(
          'group/footer border-border-subtle flex shrink-0 items-center gap-1 border-t px-2',
          collapsed ? 'h-auto flex-col gap-1.5 px-1.5 py-2' : 'h-[52px]',
        )}
      >
        <ProfileButton collapsed={collapsed} />
        {!collapsed ? (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[120ms] group-focus-within/footer:opacity-100 group-hover/footer:opacity-100">
            <SignOutButton />
          </span>
        ) : (
          <SignOutButton />
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="text-muted-foreground shrink-0"
        >
          {collapsed ? (
            <CaretDoubleRight aria-hidden="true" />
          ) : (
            <CaretDoubleLeft aria-hidden="true" />
          )}
        </Button>
      </div>
    </aside>
  )
}
