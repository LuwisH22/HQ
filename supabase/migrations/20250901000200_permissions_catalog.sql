-- ===========================================================================
-- LFG HQ · Phase 1 · Permission catalogue
--
-- The full capability vocabulary of the product, including keys for features
-- that land in later phases. Seeding them now means adding chat/projects/etc.
-- never requires re-seeding every organization's roles.
-- ===========================================================================

insert into public.permissions (key, category, label, description, sort_order) values
  -- Organization
  ('organization.view',    'Organization', 'View organization',    'See organization details and settings.', 10),
  ('organization.manage',  'Organization', 'Manage organization',  'Rename the organization, change branding and defaults.', 11),
  ('organization.delete',  'Organization', 'Delete organization',  'Permanently archive the organization. Owner only.', 12),

  -- Members
  ('members.view',         'Members', 'View members',    'See the member directory and roles.', 20),
  ('members.invite',       'Members', 'Invite members',  'Send and revoke invitations.', 21),
  ('members.manage',       'Members', 'Manage members',  'Change roles and suspend or reactivate members.', 22),
  ('members.remove',       'Members', 'Remove members',  'Remove a member from the organization.', 23),

  -- Roles and audit
  ('roles.view',           'Access control', 'View roles',   'See roles and their permissions.', 30),
  ('roles.manage',         'Access control', 'Manage roles', 'Create roles and change which permissions they grant.', 31),
  ('audit.read',           'Access control', 'Read audit log', 'View the administrative audit trail.', 32),

  -- Chat (Phase 2)
  ('channels.view',        'Chat', 'View channels',     'See and read channels they belong to.', 40),
  ('channels.create',      'Chat', 'Create channels',   'Create new channels.', 41),
  ('channels.manage',      'Chat', 'Manage channels',   'Rename, archive and set membership of channels.', 42),
  ('messages.send',        'Chat', 'Send messages',     'Post messages and attachments.', 43),
  ('messages.pin',         'Chat', 'Pin messages',      'Pin and unpin messages in a channel.', 44),
  ('messages.moderate',    'Chat', 'Moderate messages', 'Delete other members'' messages.', 45),

  -- Projects (Phase 3)
  ('projects.view',        'Projects', 'View projects',   'See projects they are a member of.', 50),
  ('projects.create',      'Projects', 'Create projects', 'Start new projects.', 51),
  ('projects.manage',      'Projects', 'Manage projects', 'Edit project settings and membership.', 52),
  ('projects.delete',      'Projects', 'Delete projects', 'Archive or delete a project.', 53),
  ('tasks.view',           'Projects', 'View tasks',      'See tasks on visible projects.', 54),
  ('tasks.create',         'Projects', 'Create tasks',    'Add tasks to a project.', 55),
  ('tasks.assign',         'Projects', 'Assign tasks',    'Assign tasks to other members.', 56),
  ('tasks.manage',         'Projects', 'Manage tasks',    'Edit or delete any task on a visible project.', 57),

  -- Calendar (Phase 4)
  ('calendar.view',        'Calendar', 'View calendar',   'See the organization calendar.', 60),
  ('calendar.create',      'Calendar', 'Create events',   'Schedule scrims, matches, meetings and deadlines.', 61),
  ('calendar.manage',      'Calendar', 'Manage events',   'Edit or cancel any event.', 62),

  -- Teams
  ('teams.view',           'Teams', 'View teams',          'See teams and rosters.', 70),
  ('teams.manage',         'Teams', 'Manage teams',        'Create and configure teams.', 71),
  ('teams.roster_manage',  'Teams', 'Manage rosters',      'Add, move and change the status of players.', 72),

  -- Files (Phase 5)
  ('files.view',           'Files', 'View files',   'Browse and download files they have access to.', 80),
  ('files.upload',         'Files', 'Upload files', 'Upload files and create folders.', 81),
  ('files.manage',         'Files', 'Manage files', 'Rename, move and change permissions on files.', 82),
  ('files.delete',         'Files', 'Delete files', 'Delete files and folders.', 83);

-- ---------------------------------------------------------------------------
-- Default role templates. bootstrap_organization() materialises these into
-- per-organization rows so each org can then diverge.
-- ---------------------------------------------------------------------------

create table public.role_templates (
  key          text primary key,
  name         text not null,
  description  text not null,
  rank         integer not null
);

insert into public.role_templates (key, name, description, rank) values
  ('owner',   'Owner',   'Full control of the organization, including ownership transfer.', 0),
  ('admin',   'Admin',   'Manages members, permissions, channels and files.',              10),
  ('manager', 'Manager', 'Runs projects, teams, the calendar and channels.',               20),
  ('coach',   'Coach',   'Manages their teams, schedules and team projects.',              30),
  ('player',  'Player',  'Works assigned tasks, team channels, calendar and DMs.',         40),
  ('staff',   'Staff',   'Baseline access, extended per organization as needed.',          50);

create table public.role_template_permissions (
  role_template_key  text not null references public.role_templates (key) on delete cascade,
  permission_key     text not null references public.permissions (key) on delete cascade,
  primary key (role_template_key, permission_key)
);

-- Owner: everything.
insert into public.role_template_permissions (role_template_key, permission_key)
select 'owner', key from public.permissions;

-- Admin: everything except deleting the organization.
insert into public.role_template_permissions (role_template_key, permission_key)
select 'admin', key from public.permissions where key <> 'organization.delete';

insert into public.role_template_permissions (role_template_key, permission_key) values
  -- Manager
  ('manager', 'organization.view'),
  ('manager', 'members.view'), ('manager', 'members.invite'), ('manager', 'members.manage'),
  ('manager', 'roles.view'),
  ('manager', 'channels.view'), ('manager', 'channels.create'), ('manager', 'channels.manage'),
  ('manager', 'messages.send'), ('manager', 'messages.pin'), ('manager', 'messages.moderate'),
  ('manager', 'projects.view'), ('manager', 'projects.create'), ('manager', 'projects.manage'),
  ('manager', 'projects.delete'),
  ('manager', 'tasks.view'), ('manager', 'tasks.create'), ('manager', 'tasks.assign'),
  ('manager', 'tasks.manage'),
  ('manager', 'calendar.view'), ('manager', 'calendar.create'), ('manager', 'calendar.manage'),
  ('manager', 'teams.view'), ('manager', 'teams.manage'), ('manager', 'teams.roster_manage'),
  ('manager', 'files.view'), ('manager', 'files.upload'), ('manager', 'files.manage'),

  -- Coach
  ('coach', 'organization.view'),
  ('coach', 'members.view'),
  ('coach', 'channels.view'), ('coach', 'channels.create'),
  ('coach', 'messages.send'), ('coach', 'messages.pin'),
  ('coach', 'projects.view'), ('coach', 'projects.create'), ('coach', 'projects.manage'),
  ('coach', 'tasks.view'), ('coach', 'tasks.create'), ('coach', 'tasks.assign'),
  ('coach', 'tasks.manage'),
  ('coach', 'calendar.view'), ('coach', 'calendar.create'), ('coach', 'calendar.manage'),
  ('coach', 'teams.view'), ('coach', 'teams.roster_manage'),
  ('coach', 'files.view'), ('coach', 'files.upload'),

  -- Player
  ('player', 'organization.view'),
  ('player', 'members.view'),
  ('player', 'channels.view'),
  ('player', 'messages.send'),
  ('player', 'projects.view'),
  ('player', 'tasks.view'),
  ('player', 'calendar.view'),
  ('player', 'teams.view'),
  ('player', 'files.view'), ('player', 'files.upload'),

  -- Staff
  ('staff', 'organization.view'),
  ('staff', 'members.view'),
  ('staff', 'channels.view'),
  ('staff', 'messages.send'),
  ('staff', 'projects.view'),
  ('staff', 'tasks.view'),
  ('staff', 'calendar.view'),
  ('staff', 'teams.view'),
  ('staff', 'files.view');
