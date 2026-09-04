import type { Permission } from '@/lib/permissions'

/**
 * Catalogue metadata for the permission matrix in demo mode.
 *
 * Mirrors the `permissions` table seeded by
 * `supabase/migrations/20250901000200_permissions_catalog.sql`.
 * `demo-database.test.ts` asserts this stays in step with `PERMISSIONS`, so a
 * new capability cannot be added to one and forgotten in the other.
 */
export interface PermissionCatalogEntry {
  key: Permission
  category: string
  label: string
  description: string
}

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  // Organization
  {
    key: 'organization.view',
    category: 'Organization',
    label: 'View organization',
    description: 'See organization details and settings.',
  },
  {
    key: 'organization.manage',
    category: 'Organization',
    label: 'Manage organization',
    description: 'Rename the organization, change branding and defaults.',
  },
  {
    key: 'organization.delete',
    category: 'Organization',
    label: 'Delete organization',
    description: 'Permanently archive the organization. Owner only.',
  },

  // Members
  {
    key: 'members.view',
    category: 'Members',
    label: 'View members',
    description: 'See the member directory and roles.',
  },
  {
    key: 'members.invite',
    category: 'Members',
    label: 'Invite members',
    description: 'Send and revoke invitations.',
  },
  {
    key: 'members.manage',
    category: 'Members',
    label: 'Manage members',
    description: 'Change roles and suspend or reactivate members.',
  },
  {
    key: 'members.remove',
    category: 'Members',
    label: 'Remove members',
    description: 'Remove a member from the organization.',
  },

  // Access control
  {
    key: 'roles.view',
    category: 'Access control',
    label: 'View roles',
    description: 'See roles and their permissions.',
  },
  {
    key: 'roles.manage',
    category: 'Access control',
    label: 'Manage roles',
    description: 'Create roles and change which permissions they grant.',
  },
  {
    key: 'audit.read',
    category: 'Access control',
    label: 'Read audit log',
    description: 'View the administrative audit trail.',
  },

  // Chat
  {
    key: 'channels.view',
    category: 'Chat',
    label: 'View channels',
    description: 'See and read channels they belong to.',
  },
  {
    key: 'channels.create',
    category: 'Chat',
    label: 'Create channels',
    description: 'Create new channels.',
  },
  {
    key: 'channels.manage',
    category: 'Chat',
    label: 'Manage channels',
    description: 'Rename, archive and set membership of channels.',
  },
  {
    key: 'messages.send',
    category: 'Chat',
    label: 'Send messages',
    description: 'Post messages and attachments.',
  },
  {
    key: 'messages.pin',
    category: 'Chat',
    label: 'Pin messages',
    description: 'Pin and unpin messages in a channel.',
  },
  {
    key: 'messages.moderate',
    category: 'Chat',
    label: 'Moderate messages',
    description: "Delete other members' messages.",
  },

  // Projects
  {
    key: 'projects.view',
    category: 'Projects',
    label: 'View projects',
    description: 'See projects they are a member of.',
  },
  {
    key: 'projects.create',
    category: 'Projects',
    label: 'Create projects',
    description: 'Start new projects.',
  },
  {
    key: 'projects.manage',
    category: 'Projects',
    label: 'Manage projects',
    description: 'Edit project settings and membership.',
  },
  {
    key: 'projects.delete',
    category: 'Projects',
    label: 'Delete projects',
    description: 'Archive or delete a project.',
  },
  {
    key: 'tasks.view',
    category: 'Projects',
    label: 'View tasks',
    description: 'See tasks on visible projects.',
  },
  {
    key: 'tasks.create',
    category: 'Projects',
    label: 'Create tasks',
    description: 'Add tasks to a project.',
  },
  {
    key: 'tasks.assign',
    category: 'Projects',
    label: 'Assign tasks',
    description: 'Assign tasks to other members.',
  },
  {
    key: 'tasks.manage',
    category: 'Projects',
    label: 'Manage tasks',
    description: 'Edit or delete any task on a visible project.',
  },

  // Calendar
  {
    key: 'calendar.view',
    category: 'Calendar',
    label: 'View calendar',
    description: 'See the organization calendar.',
  },
  {
    key: 'calendar.create',
    category: 'Calendar',
    label: 'Create events',
    description: 'Schedule scrims, matches, meetings and deadlines.',
  },
  {
    key: 'calendar.manage',
    category: 'Calendar',
    label: 'Manage events',
    description: 'Edit or cancel any event.',
  },

  // Teams
  {
    key: 'teams.view',
    category: 'Teams',
    label: 'View teams',
    description: 'See teams and rosters.',
  },
  {
    key: 'teams.manage',
    category: 'Teams',
    label: 'Manage teams',
    description: 'Create and configure teams.',
  },
  {
    key: 'teams.roster_manage',
    category: 'Teams',
    label: 'Manage rosters',
    description: 'Add, move and change the status of players.',
  },

  // Files
  {
    key: 'files.view',
    category: 'Files',
    label: 'View files',
    description: 'Browse and download files they have access to.',
  },
  {
    key: 'files.upload',
    category: 'Files',
    label: 'Upload files',
    description: 'Upload files and create folders.',
  },
  {
    key: 'files.manage',
    category: 'Files',
    label: 'Manage files',
    description: 'Rename, move and change permissions on files.',
  },
  {
    key: 'files.delete',
    category: 'Files',
    label: 'Delete files',
    description: 'Delete files and folders.',
  },
]
