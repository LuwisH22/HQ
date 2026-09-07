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

function NavRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const upcoming = !item.shipped

  const link = (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm transition-colors duration-[140ms]',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-primary/14 text-foreground font-medium'
            : 'text-muted-foreground hover:bg-foreground/7 hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Active marker sits outside the padding so it reads as a rail. */}
          <span
            aria-hidden="true"
            className={cn(
              'bg-primary absolute -left-2 h-4 w-0.5 rounded-xs transition-opacity',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          <item.icon className="size-4 shrink-0" aria-hidden="true" />
          {collapsed ? (
            <span className="sr-only">{item.label}</span>
          ) : (
            <>
              <span className="truncate">{item.label}</span>
              {upcoming ? (
                <span className="text-3xs text-foreground/38 ml-auto font-semibold tracking-[0.1em] uppercase">
                  Soon
                </span>
              ) : null}
            </>
          )}
        </>
      )}
    </NavLink>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {upcoming ? ' · coming soon' : ''}
      </TooltipContent>
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

  const visibleItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => item.requires.length === 0 || permissions.canAny(item.requires)),
    [permissions],
  )

  const primaryItems = visibleItems.filter((item) => item.group === 'primary')
  const organizationItems = visibleItems.filter((item) => item.group === 'organization')
  // Collapsed to icons there is no room for a channel list, so the directory
  // link stands in for it rather than the channels becoming unreachable.
  const chatItems = visibleItems.filter((item) => item.group === 'chat' && item.shipped)

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'bg-sidebar flex h-full shrink-0 flex-col transition-[width] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)]',
        collapsed ? 'w-14' : 'w-64',
      )}
    >
      <div className={cn('p-2', collapsed && 'px-1.5')}>
        <OrganizationSwitcher collapsed={collapsed} />
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
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
              <p className="text-3xs text-foreground/42 px-1 pt-4 pb-1 font-semibold tracking-[0.1em] uppercase">
                Organization
              </p>
            ) : (
              <div className="border-border my-3 border-t" aria-hidden="true" />
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

      {/* Three controls, three jobs: your profile, the way out, and the
          width of this panel. They used to be a dropdown and one small arrow,
          which made signing out something you had to go looking for. */}
      <div className={cn('border-border shrink-0 border-t p-2', collapsed && 'px-1.5')}>
        <div className={cn('flex items-center gap-1', collapsed && 'flex-col gap-1.5')}>
          <ProfileButton collapsed={collapsed} />
          <SignOutButton />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className={cn('text-muted-foreground mt-1', collapsed ? 'mx-auto flex' : 'ml-auto flex')}
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
