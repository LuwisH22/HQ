-- ===========================================================================
-- LFG HQ · Phase 1.5 · B2 · Effective membership status
--
-- Every authorization helper in this schema asked the same question —
-- `m.status = 'active'` — in sixteen places. That is no longer sufficient:
--
--   * a suspension can lapse, and must restore access with no cron job and no
--     scheduled write;
--   * a ban must never resolve to active, whatever the timestamps say.
--
-- So the question is asked once, here, and every helper is rewritten to use
-- it. This is the riskiest migration in B2: miss one call site and a banned
-- member keeps reading data, or an active member is locked out. The live
-- verification asserts the outcome rather than trusting the rewrite.
--
-- Rules:
--   active                              -> effective
--   suspended, suspended_until <= now() -> effective   (lapsed, restored)
--   suspended, suspended_until > now()  -> NOT effective
--   suspended, suspended_until is null  -> NOT effective  (indefinite)
--   banned                              -> NEVER effective
-- ===========================================================================

create or replace function public.is_effectively_active(
  p_status public.member_status,
  p_suspended_until timestamptz
)
returns boolean
language sql
immutable
parallel safe
as $fn$
  select p_status = 'active'
      or (
        p_status = 'suspended'
        and p_suspended_until is not null
        and p_suspended_until <= now()
      );
$fn$;

comment on function public.is_effectively_active is
  'Derives access from stored state plus expiry. A lapsed suspension restores access without anything being written; a ban never resolves to active.';

revoke execute on function public.is_effectively_active(public.member_status, timestamptz)
  from public, anon;
grant execute on function public.is_effectively_active(public.member_status, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers, rewritten. Bodies are otherwise unchanged from 20250902000300.
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and public.is_effectively_active(m.status, m.suspended_until)
  );
$fn$;

create or replace function public.shares_organization_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and public.is_effectively_active(mine.status, mine.suspended_until)
      and theirs.user_id = p_user_id
  );
$fn$;

create or replace function public.my_role_rank(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when exists (
      select 1
      from public.organizations o
      join public.organization_members m
        on m.organization_id = o.id
       and m.user_id = (select auth.uid())
       and public.is_effectively_active(m.status, m.suspended_until)
      where o.id = p_organization_id
        and o.owner_id = (select auth.uid())
    ) then -1
    else (
      select min(r.rank)
      from public.organization_members m
      join public.member_roles mr on mr.member_id = m.id
      join public.roles r on r.id = mr.role_id
      where m.organization_id = p_organization_id
        and m.user_id = (select auth.uid())
        and public.is_effectively_active(m.status, m.suspended_until)
    )
  end;
$fn$;

create or replace function public.has_org_permission(p_organization_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    exists (
      select 1
      from public.organizations o
      join public.organization_members m
        on m.organization_id = o.id
       and m.user_id = (select auth.uid())
       and public.is_effectively_active(m.status, m.suspended_until)
      where o.id = p_organization_id
        and o.owner_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.organization_members m
      join public.member_roles mr on mr.member_id = m.id
      join public.role_permissions rp on rp.role_id = mr.role_id
      where m.organization_id = p_organization_id
        and m.user_id = (select auth.uid())
        and public.is_effectively_active(m.status, m.suspended_until)
        and rp.permission_key = p_permission
    );
$fn$;

create or replace function public.my_permissions(p_organization_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.key
  from public.permissions p
  where exists (
    select 1
    from public.organizations o
    join public.organization_members m
      on m.organization_id = o.id
     and m.user_id = (select auth.uid())
     and public.is_effectively_active(m.status, m.suspended_until)
    where o.id = p_organization_id
      and o.owner_id = (select auth.uid())
  )
  union
  select distinct rp.permission_key
  from public.organization_members m
  join public.member_roles mr on mr.member_id = m.id
  join public.role_permissions rp on rp.role_id = mr.role_id
  where m.organization_id = p_organization_id
    and m.user_id = (select auth.uid())
    and public.is_effectively_active(m.status, m.suspended_until);
$fn$;

-- The organization-owner lookup used by bootstrap and by the guards. Ownership
-- itself is unconditional, but a suspended owner should not be able to act, so
-- effective status is required here too.
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
    join public.organization_members m
      on m.organization_id = o.id
     and m.user_id = (select auth.uid())
     and public.is_effectively_active(m.status, m.suspended_until)
    where o.id = p_organization_id
      and o.owner_id = (select auth.uid())
  );
$fn$;

-- CREATE OR REPLACE resets the default PUBLIC grant, so each is closed again.
revoke execute on function public.is_org_member(uuid)                from public, anon;
revoke execute on function public.shares_organization_with(uuid)     from public, anon;
revoke execute on function public.my_role_rank(uuid)                 from public, anon;
revoke execute on function public.has_org_permission(uuid, text)     from public, anon;
revoke execute on function public.my_permissions(uuid)               from public, anon;
revoke execute on function public.is_org_owner(uuid)                 from public, anon;

grant execute on function public.is_org_member(uuid)                 to authenticated;
grant execute on function public.shares_organization_with(uuid)      to authenticated;
grant execute on function public.my_role_rank(uuid)                  to authenticated;
grant execute on function public.has_org_permission(uuid, text)      to authenticated;
grant execute on function public.my_permissions(uuid)                to authenticated;
grant execute on function public.is_org_owner(uuid)                  to authenticated;
