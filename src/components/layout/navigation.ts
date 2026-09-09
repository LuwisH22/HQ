import {
  Bell,
  CalendarBlank,
  Kanban,
  Files,
  Hash,
  SquaresFour,
  ChatTeardropText,
  Gear,
  Users,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react'
import type { Permission } from '@/lib/permissions'

export interface NavItem {
  id: string
  label: string
  path: string
  icon: Icon
  /** Hidden unless the member holds at least one of these. Empty means always. */
  requires: readonly Permission[]
  /**
   * The build phase that makes this section real, used for the copy on the
   * placeholder pages.
   */
  phase: 1 | 2 | 3 | 4 | 5 | 6
  /**
   * Whether the section actually works yet. Kept separate from `phase`
   * because a phase ships in parts: Phase 2 built channels while direct
   * messages are still to come, and one number cannot say that.
   */
  shipped: boolean
  /**
   * Where the sidebar puts it.
   *
   * `chat` is the exception: those two are not rendered as rows at all when
   * the sidebar is open, because the channel list itself stands in for them.
   * They stay in this list so the command palette, the mobile drawer and the
   * routes still agree on one description of the product.
   */
  group: 'primary' | 'chat' | 'organization'
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
    icon: SquaresFour,
    requires: [],
    phase: 1,
    shipped: true,
    group: 'primary',
  },
  {
    id: 'messages',
    label: 'Direct messages',
    path: '/messages',
    icon: ChatTeardropText,
    requires: ['channels.view'],
    phase: 2,
    shipped: false,
    group: 'chat',
  },
  {
    id: 'channels',
    label: 'Channels',
    path: '/channels',
    icon: Hash,
    requires: ['channels.view'],
    phase: 2,
    shipped: true,
    group: 'chat',
  },
  {
    id: 'projects',
    label: 'Projects',
    path: '/projects',
    icon: Kanban,
    requires: ['projects.view'],
    phase: 3,
    shipped: true,
    group: 'organization',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    path: '/calendar',
    icon: CalendarBlank,
    requires: ['calendar.view'],
    phase: 4,
    shipped: true,
    group: 'organization',
  },
  {
    id: 'teams',
    label: 'Teams',
    path: '/teams',
    icon: UsersThree,
    requires: ['teams.view'],
    phase: 3,
    shipped: false,
    group: 'organization',
  },
  {
    id: 'files',
    label: 'Files',
    path: '/files',
    icon: Files,
    requires: ['files.view'],
    phase: 5,
    shipped: false,
    group: 'organization',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    path: '/notifications',
    icon: Bell,
    requires: [],
    phase: 6,
    shipped: false,
    group: 'organization',
  },
  {
    id: 'members',
    label: 'Members',
    path: '/members',
    icon: Users,
    requires: ['members.view'],
    phase: 1,
    shipped: true,
    group: 'organization',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: Gear,
    requires: [],
    phase: 1,
    shipped: true,
    group: 'organization',
  },
] as const

/**
 * Sections shown in the bottom bar on phones, in order.
 *
 * Five slots, and they go to what works: channels rather than direct
 * messages, which is still a placeholder.
 */
export const MOBILE_NAV_IDS = ['dashboard', 'channels', 'projects', 'calendar', 'members'] as const
