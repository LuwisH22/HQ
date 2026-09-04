-- ===========================================================================
-- LFG HQ · Phase 1.5 · B2 · Moderation permissions
--
-- Three keys, and only three. Channel permissions belong to B3.
--
-- Splitting moderation out of `members.manage` matters: until now anyone who
-- could change a colleague's role could also suspend them. Banning in
-- particular deserves its own capability.
--
-- Granting these to EXISTING organizations is done by capability, never by
-- role name or key. A role that can already manage members gains the ability
-- to suspend; a role that can already remove members — a strictly heavier
-- power than a temporary suspension — gains ban and unban. Nothing here reads
-- `roles.name`, `roles.key` or `is_system`, so an organization that has
-- renamed or reordered everything still gets a sensible result.
-- ===========================================================================

insert into public.permissions (key, category, label, description, sort_order) values
  ('members.suspend', 'Members', 'Suspend members',
   'Temporarily block a member from the organization, with an optional expiry.', 24),
  ('members.ban',     'Members', 'Ban members',
   'Permanently block a member. Requires an explicit unban to reverse.', 25),
  ('members.unban',   'Members', 'Restore members',
   'Lift a suspension or a ban and restore access.', 26)
on conflict (key) do nothing;

-- --- Templates, so newly provisioned organizations inherit the same shape ---

insert into public.role_template_permissions (role_template_key, permission_key)
select rtp.role_template_key, 'members.suspend'
from public.role_template_permissions rtp
where rtp.permission_key = 'members.manage'
on conflict do nothing;

insert into public.role_template_permissions (role_template_key, permission_key)
select rtp.role_template_key, k.key
from public.role_template_permissions rtp
cross join (values ('members.ban'), ('members.unban')) as k(key)
where rtp.permission_key = 'members.remove'
on conflict do nothing;

-- --- Existing organizations ------------------------------------------------

insert into public.role_permissions (role_id, permission_key)
select rp.role_id, 'members.suspend'
from public.role_permissions rp
where rp.permission_key = 'members.manage'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select rp.role_id, k.key
from public.role_permissions rp
cross join (values ('members.ban'), ('members.unban')) as k(key)
where rp.permission_key = 'members.remove'
on conflict do nothing;

-- The owner needs no rows at all: has_org_permission short-circuits on
-- organizations.owner_id, which is what stops a permission edit from locking
-- an owner out of their own organization.

comment on column public.permissions.key is
  'Stable capability identifier. Roles are built from these; role names never carry meaning.';
