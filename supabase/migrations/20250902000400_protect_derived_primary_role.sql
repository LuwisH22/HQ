-- ===========================================================================
-- LFG HQ · Phase 1.5 · B1 · organization_members.role_id is derived, not input
--
-- Found by scripts/verify-live.mjs immediately after B1 landed: the column is
-- maintained by tg_sync_primary_role, but the "Member managers can update
-- memberships" policy still let a client write it directly. Doing so left the
-- membership claiming one role while member_roles — the source of truth — held
-- another.
--
-- Nothing escalated: my_permissions and my_role_rank read member_roles, so the
-- drifted column granted no authority. But a derived column that disagrees
-- with its source is a bug waiting to be trusted by the next reader, so it is
-- closed here.
--
-- Status updates are deliberately still allowed; B2 moderation needs them.
-- ===========================================================================

-- --- Repair any drift ------------------------------------------------------
-- Idempotent: recomputes every membership's primary role from member_roles.
-- Runs with auth.uid() null, which the guard treats as a trusted context.

update public.organization_members m
set role_id = pick.role_id
from (
  select distinct on (mr.member_id)
         mr.member_id,
         mr.role_id
  from public.member_roles mr
  join public.roles r on r.id = mr.role_id
  order by mr.member_id, r.rank asc, r.created_at asc
) as pick
where pick.member_id = m.id
  and m.role_id is distinct from pick.role_id;

-- --- Refuse direct writes from a client session ---------------------------

create or replace function public.tg_protect_derived_primary_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- pg_trigger_depth() is 1 when this fires from a client's own UPDATE, and 2
  -- when it fires from the UPDATE that tg_sync_primary_role issues. That is
  -- what distinguishes "someone wrote the derived column" from "the derived
  -- column is being maintained".
  --
  -- A null auth.uid() is a migration or the service role, which is trusted.
  if new.role_id is distinct from old.role_id
     and (select auth.uid()) is not null
     and pg_trigger_depth() < 2 then
    raise exception
      'organization_members.role_id is derived from member_roles. Use assign_role_to_member() / unassign_role_from_member().'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$fn$;

create trigger organization_members_protect_primary_role
  before update of role_id on public.organization_members
  for each row execute function public.tg_protect_derived_primary_role();

comment on column public.organization_members.role_id is
  'Derived primary role: the most authoritative role in member_roles. Maintained by trigger; not client-writable.';
