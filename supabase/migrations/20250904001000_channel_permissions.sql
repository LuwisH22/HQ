-- ===========================================================================
-- LFG HQ · Phase 1.5 · B3 · Channel permissions
--
-- Two keys, and only two. `channels.view`, `channels.create`, `channels.manage`
-- and the `messages.*` family already exist and are already granted, so B3
-- adds only what genuinely has no equivalent:
--
--   * channels.delete — destroying a channel, and later its entire message
--     history, is materially heavier than renaming one. Folding it into
--     channels.manage would mean anyone who may rename may also destroy.
--
--   * channels.permissions_manage — this is the important one. If changing an
--     override were covered by channels.manage, anyone who may rename a
--     channel could also grant themselves access to a private one. That is a
--     real escalation path, so it gets its own capability.
--
-- Categories deliberately get no permissions of their own: a category is a
-- container, and channels.manage already covers arranging them. Adding
-- categories.* would grow the catalogue without buying any safety.
--
-- Granting to existing organizations is done by capability, never by role name
-- or key — the same rule B2 used.
-- ===========================================================================

insert into public.permissions (key, category, label, description, sort_order) values
  ('channels.delete', 'Chat', 'Delete channels',
   'Permanently remove a channel. Archiving is the reversible alternative.', 34),
  ('channels.permissions_manage', 'Chat', 'Manage channel permissions',
   'Decide which roles may see and post in each channel.', 35)
on conflict (key) do nothing;

-- --- Templates, so newly provisioned organizations inherit the same shape ---

insert into public.role_template_permissions (role_template_key, permission_key)
select rtp.role_template_key, k.key
from public.role_template_permissions rtp
cross join (values ('channels.delete'), ('channels.permissions_manage')) as k(key)
where rtp.permission_key = 'channels.manage'
on conflict do nothing;

-- --- Existing organizations ------------------------------------------------

insert into public.role_permissions (role_id, permission_key)
select rp.role_id, k.key
from public.role_permissions rp
cross join (values ('channels.delete'), ('channels.permissions_manage')) as k(key)
where rp.permission_key = 'channels.manage'
on conflict do nothing;

-- The owner needs no rows: has_org_permission short-circuits on
-- organizations.owner_id, which is what keeps a permission edit from locking
-- an owner out of their own organization.
