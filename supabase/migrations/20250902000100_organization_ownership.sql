-- ===========================================================================
-- LFG HQ · Phase 1.5 · B1 · Ownership becomes an organization-level column
--
-- Until now ownership was inferred two different ways, and both are unsafe the
-- moment roles become fully user-defined:
--
--   * `roles.rank = 0`   — used by tg_guard_member_changes and by the RLS
--                          policies that protect "the owner role". Reorder a
--                          role to rank 0 and it inherits that protection.
--   * `roles.key = 'owner'` — used by bootstrap_organization to find the role
--                          to grant. Rename or delete that role and the anchor
--                          is gone.
--
-- Ownership is therefore moved onto the organization itself. After this
-- migration no authorization logic reads a role's name, key, rank or
-- is_system flag to decide who owns an organization.
--
-- The owner is implicitly all-powerful inside their own organization (see
-- 20250902000300). That is not convenience: once an administrator can edit the
-- permissions of every role — including whichever role the owner happens to
-- hold — an owner who derived authority from role rows could lock themselves
-- out of their own organization.
--
-- Additive only. No table or column is dropped.
-- ===========================================================================

alter table public.organizations
  add column owner_id uuid references public.profiles (id) on delete restrict;

comment on column public.organizations.owner_id is
  'Sole source of truth for ownership. Never derived from role name, key, rank or is_system.';

-- --- Backfill --------------------------------------------------------------
-- The existing owner is the active member holding the most authoritative role.
-- This is the last time rank is used to mean "owner"; from here it is only a
-- hierarchy signal.

update public.organizations o
set owner_id = pick.user_id
from (
  select distinct on (m.organization_id)
         m.organization_id,
         m.user_id
  from public.organization_members m
  join public.roles r on r.id = m.role_id
  where m.status = 'active'
  order by m.organization_id, r.rank asc, m.joined_at asc
) as pick
where pick.organization_id = o.id
  and o.owner_id is null;

-- Refuse to continue rather than invent an owner for an organization that has
-- none. A failed migration is recoverable; a wrong owner is not.
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing from public.organizations where owner_id is null;
  if v_missing > 0 then
    raise exception
      'Cannot enforce ownership: % organization(s) have no resolvable active member', v_missing;
  end if;
end $$;

alter table public.organizations alter column owner_id set not null;

create index organizations_owner_idx on public.organizations (owner_id);

-- --- Helper ----------------------------------------------------------------

create or replace function public.is_org_owner(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
      and o.owner_id = (select auth.uid())
  );
$fn$;

comment on function public.is_org_owner is
  'True when the caller owns the organization. Ownership transfer is gated on this, never on a permission — a permission could be granted to a role.';

-- PostgreSQL grants EXECUTE to PUBLIC by default; close that before granting.
revoke execute on function public.is_org_owner(uuid) from public, anon;
grant execute on function public.is_org_owner(uuid) to authenticated;
