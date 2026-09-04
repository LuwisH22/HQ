import {
  Bell,
  CalendarDays,
  FolderKanban,
  Files,
  Hash,
  LayoutDashboard,
  MessageSquare,
  Settings,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/lib/permissions'

export interface NavItem {
  id: string
  label: string
  path: string
  icon: LucideIcon
  /** Hidden unless the member holds at least one of these. Empty means always. */
  requires: readonly Permission[]
  /**
   * The build phase that makes this section real. Anything above Phase 1
   * routes to a placeholder rather than pretending to work.
   */
  phase: 1 | 2 | 3 | 4 | 5 | 6
  /** Grouping in the sidebar. */
  group: 'workspace' | 'organization'
}

/**
 * The whole product's navigation, declared once.
 *
 * The sidebar, the mobile bar and the command palette all read from this list,
 * so a section can never appear in one and be missing from another.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: '/',
    icon: LayoutDashboard,
    requires: [],
    phase: 1,
    group: 'workspace',
  },
  {
    id: 'messages',
    label: 'Messages',
    path: '/messages',
    icon: MessageSquare,
    requires: ['channels.view'],
    phase: 2,
    group: 'workspace',
  },
  {
    id: 'channels',
    label: 'Channels',
    path: '/channels',
    icon: Hash,
    requires: ['channels.view'],
    phase: 2,
    group: 'workspace',
  },
  {
    id: 'projects',
    label: 'Projects',
    path: '/projects',
    icon: FolderKanban,
    requires: ['projects.view'],
    phase: 3,
    group: 'workspace',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    path: '/calendar',
    icon: CalendarDays,
    requires: ['calendar.view'],
    phase: 4,
    group: 'workspace',
  },
  {
    id: 'teams',
    label: 'Teams',
    path: '/teams',
    icon: UsersRound,
    requires: ['teams.view'],
    phase: 3,
    group: 'workspace',
  },
  {
    id: 'files',
    label: 'Files',
    path: '/files',
    icon: Files,
    requires: ['files.view'],
    phase: 5,
    group: 'workspace',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    path: '/notifications',
    icon: Bell,
    requires: [],
    phase: 6,
    group: 'workspace',
  },
  {
    id: 'members',
    label: 'Members',
    path: '/members',
    icon: Users,
    requires: ['members.view'],
    phase: 1,
    group: 'organization',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: Settings,
    requires: [],
    phase: 1,
    group: 'organization',
  },
] as const

/** Sections shown in the bottom bar on phones, in order. */
export const MOBILE_NAV_IDS = ['dashboard', 'messages', 'projects', 'calendar', 'members'] as const

/** Which build phase is live. Sections above this render a placeholder. */
export const CURRENT_PHASE = 1
