-- ===========================================================================
-- LFG HQ · Phase 1.5 · B1 · Multiple roles per member
--
-- `member_roles` becomes the source of truth for who holds what.
-- `organization_members.role_id` is kept — not dropped — and demoted to a
-- trigger-maintained *derived primary role*: the most authoritative role the
-- member holds. Everything already built on that column (the roster UI, the
-- invite flow, the membership guard) therefore keeps working untouched, which
-- is the whole reason for taking this route rather than dropping it.
--
-- Additive only.
-- ===========================================================================

-- Provenance for custom roles. Nullable because the roles provisioned by
-- bootstrap_organization were not created by any particular person.
alter table public.roles
  add column created_by uuid references public.profiles (id) on delete set null;

create table public.member_roles (
  member_id    uuid not null references public.organization_members (id) on delete cascade,
  role_id      uuid not null references public.roles (id) on delete cascade,
  assigned_by  uuid references public.profiles (id) on delete set null,
  assigned_at  timestamptz not null default now(),

  primary key (member_id, role_id)
);

comment on table public.member_roles is
  'Source of truth for role assignment. organization_members.role_id is derived from this.';

create index member_roles_role_idx on public.member_roles (role_id);

-- --- Backfill before the triggers exist, so the sync is a no-op ------------

insert into public.member_roles (member_id, role_id)
select m.id, m.role_id
from public.organization_members m
on conflict do nothing;

-- --- A role may only be assigned inside its own organization --------------
-- Mirrors tg_member_role_matches_org, which guards the same mistake on the
-- membership row.

create or replace function public.tg_member_role_org_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_org uuid;
  v_role_org   uuid;
begin
  select organization_id into v_member_org
  from public.organization_members where id = new.member_id;

  select organization_id into v_role_org
  from public.roles where id = new.role_id;

  if v_member_org is null or v_role_org is null or v_member_org <> v_role_org then
    raise exception 'Role does not belong to that member''s organization'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

create trigger member_roles_org_match
  before insert or update on public.member_roles
  for each row execute function public.tg_member_role_org_match();

-- --- Keep organization_members.role_id in step ----------------------------

create or replace function public.tg_sync_primary_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member_id uuid;
  v_role_id   uuid;
begin
  v_member_id := coalesce(new.member_id, old.member_id);

  -- Most authoritative role wins; created_at only breaks ties deterministically.
  select mr.role_id into v_role_id
  from public.member_roles mr
  join public.roles r on r.id = mr.role_id
  where mr.member_id = v_member_id
  order by r.rank asc, r.created_at asc
  limit 1;

  -- No rows left means the membership itself is being deleted; leave the
  -- column alone and let the cascade finish.
  if v_role_id is not null then
    update public.organization_members
    set role_id = v_role_id
    where id = v_member_id
      and role_id is distinct from v_role_id;
  end if;

  return null;
end;
$fn$;

create trigger member_roles_sync_primary
  after insert or update or delete on public.member_roles
  for each row execute function public.tg_sync_primary_role();

-- --- A member can never reach zero roles ----------------------------------

create or replace function public.tg_member_roles_keep_one()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if exists (select 1 from public.member_roles where member_id = old.member_id) then
    return old;
  end if;

  -- Zero roles is fine when the membership is on its way out too — that is a
  -- cascade, not someone stripping a colleague of every role.
  if exists (select 1 from public.organization_members where id = old.member_id) then
    raise exception 'A member must keep at least one role'
      using errcode = 'check_violation';
  end if;

  return old;
end;
$fn$;

create trigger member_roles_keep_one
  after delete on public.member_roles
  for each row execute function public.tg_member_roles_keep_one();

-- --- RLS -------------------------------------------------------------------
-- Readable by anyone in the organization; writable only through the
-- SECURITY DEFINER routines in 20250902000300, which audit and enforce
-- hierarchy. There is deliberately no client write policy.

alter table public.member_roles enable row level security;

create policy "Members can read role assignments in their organization"
  on public.member_roles for select to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.id = member_roles.member_id
        and public.is_org_member(m.organization_id)
    )
  );

revoke all on public.member_roles from anon;
grant select on public.member_roles to authenticated;
