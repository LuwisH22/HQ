import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { Buildings, Hash, Shield, type Icon } from '@phosphor-icons/react'
import { PageHeader } from '@/components/common/PageHeader'
import { ForbiddenState } from '@/components/common/states'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'
import type { Permission } from '@/lib/permissions'

interface SettingsTab {
  label: string
  path: string
  icon: Icon
  requires?: Permission
}

/**
 * Organization and application configuration only.
 *
 * Your own profile used to sit here as the first tab, which filed a personal
 * detail under the organization's settings. It now opens from the sidebar
 * footer, where your name already is.
 */
const TABS: readonly SettingsTab[] = [
  {
    label: 'Organization',
    path: '/settings/organization',
    icon: Buildings,
    requires: 'organization.view',
  },
  { label: 'Roles & permissions', path: '/settings/roles', icon: Shield, requires: 'roles.view' },
  { label: 'Channels', path: '/settings/channels', icon: Hash, requires: 'channels.view' },
]

export function SettingsPage() {
  const { permissions } = useWorkspace()
  const tabs = TABS.filter((tab) => !tab.requires || permissions.can(tab.requires))

  return (
    <div className="mx-auto w-full max-w-[960px] space-y-5 px-4 pt-4 pb-8 sm:px-6 sm:pt-5">
      <PageHeader
        eyebrow="Organization"
        title="Settings"
        description="How this organization is configured."
      />

      {/* One nav, two shapes: a rail beside the content where there is room
          for one, and the same rows scrolling horizontally where there is
          not. The links, their labels and their order do not change. */}
      <div className="lg:flex lg:items-start lg:gap-6">
        <nav
          aria-label="Settings sections"
          className="-mx-1 shrink-0 overflow-x-auto lg:mx-0 lg:w-[200px] lg:overflow-visible"
        >
          <ul className="border-border-subtle flex gap-1 border-b px-1 lg:flex-col lg:gap-0.5 lg:border-b-0 lg:px-0">
            {tabs.map((tab) => (
              <li key={tab.path}>
                <NavLink
                  to={tab.path}
                  className={({ isActive }) =>
                    cn(
                      'relative flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors duration-[120ms]',
                      'lg:h-[30px] lg:rounded-sm lg:border-b-0 lg:px-2 lg:py-0 lg:text-sm',
                      isActive
                        ? 'border-primary text-foreground lg:bg-surface-active'
                        : 'text-secondary-foreground hover:text-foreground lg:hover:bg-accent border-transparent',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* The same blade the sidebar uses, and only where the
                          nav is a rail — a blade on a tab strip is a line
                          across the wrong axis. */}
                      {isActive ? (
                        <span aria-hidden="true" className="nav-rail hidden lg:block" />
                      ) : null}
                      <tab.icon
                        weight={isActive ? 'fill' : 'regular'}
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'text-accent-text' : 'text-muted-foreground',
                        )}
                        aria-hidden="true"
                      />
                      {tab.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 pt-5 lg:pt-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

/**
 * `/settings` on its own.
 *
 * It used to land on the profile tab, which every member could open. With
 * that gone, the first section depends on what the member may see — and a
 * member who may see none of them gets told so rather than a blank frame.
 */
export function SettingsIndex() {
  const { permissions } = useWorkspace()
  const first = TABS.find((tab) => !tab.requires || permissions.can(tab.requires))

  if (!first) return <ForbiddenState />
  return <Navigate to={first.path} replace />
}
