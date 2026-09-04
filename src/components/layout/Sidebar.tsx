import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWorkspace } from '@/hooks/use-workspace'
import { useUiStore } from '@/stores/ui.store'
import { cn } from '@/lib/utils'
import { CURRENT_PHASE, NAV_ITEMS, type NavItem } from './navigation'
import { OrganizationSwitcher } from './OrganizationSwitcher'
import { UserMenu } from './UserMenu'

function NavRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const upcoming = item.phase > CURRENT_PHASE

  const link = (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Active marker sits outside the padding so it reads as a rail. */}
          <span
            aria-hidden="true"
            className={cn(
              'bg-primary absolute -left-2 h-4 w-0.5 rounded-full transition-opacity',
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
                <span className="text-2xs text-muted-foreground/60 ml-auto font-medium tracking-wider uppercase">
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
 * Primary desktop navigation.
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

  const workspaceItems = visibleItems.filter((item) => item.group === 'workspace')
  const organizationItems = visibleItems.filter((item) => item.group === 'organization')

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'border-border bg-surface flex h-full shrink-0 flex-col border-r transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <div className={cn('p-2', collapsed && 'px-1.5')}>
        <OrganizationSwitcher collapsed={collapsed} />
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-1">
        <ul className="space-y-0.5">
          {workspaceItems.map((item) => (
            <li key={item.id}>
              <NavRow item={item} collapsed={collapsed} />
            </li>
          ))}
        </ul>

        {organizationItems.length > 0 ? (
          <>
            {!collapsed ? (
              <p className="text-2xs text-muted-foreground/70 px-2.5 pt-4 pb-1 font-semibold tracking-wider uppercase">
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

      <div className={cn('border-border border-t p-2', collapsed && 'px-1.5')}>
        <UserMenu collapsed={collapsed} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className={cn('text-muted-foreground mt-1', collapsed ? 'mx-auto flex' : 'ml-auto flex')}
        >
          {collapsed ? <ChevronsRight aria-hidden="true" /> : <ChevronsLeft aria-hidden="true" />}
        </Button>
      </div>
    </aside>
  )
}
