import { NavLink, Outlet } from 'react-router-dom'
import { Buildings, Shield, User } from '@phosphor-icons/react'
import { PageHeader } from '@/components/common/PageHeader'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'
import type { Permission } from '@/lib/permissions'

interface SettingsTab {
  label: string
  path: string
  icon: typeof User
  requires?: Permission
}

const TABS: readonly SettingsTab[] = [
  { label: 'Your profile', path: '/settings/profile', icon: User },
  {
    label: 'Organization',
    path: '/settings/organization',
    icon: Buildings,
    requires: 'organization.view',
  },
  { label: 'Roles & permissions', path: '/settings/roles', icon: Shield, requires: 'roles.view' },
]

export function SettingsPage() {
  const { permissions } = useWorkspace()
  const tabs = TABS.filter((tab) => !tab.requires || permissions.can(tab.requires))

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Settings"
        description="Your account and the organization's configuration."
      />

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
