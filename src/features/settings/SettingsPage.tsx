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
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Settings" description="How this organization is configured." />

      <nav aria-label="Settings sections" className="-mx-1 overflow-x-auto">
        <ul className="border-border flex gap-1 border-b px-1">
          {tabs.map((tab) => (
            <li key={tab.path}>
              <NavLink
                to={tab.path}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'text-muted-foreground hover:text-foreground border-transparent',
                  )
                }
              >
                <tab.icon className="size-3.5" aria-hidden="true" />
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Outlet />
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
