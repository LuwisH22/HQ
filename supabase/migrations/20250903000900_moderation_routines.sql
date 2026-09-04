-- ===========================================================================
-- LFG HQ · Phase 1.5 · B2 · Moderation routines
--
-- Moderation is only ever performed through these four routines. Writing
-- `status` directly is refused, because a direct write would skip the reason,
-- the actor, the expiry, the history row and the audit entry — everything that
-- makes a moderation decision reviewable afterwards.
--
-- The refusal uses a transaction-local GUC rather than pg_trigger_depth()
-- (which 20250902000400 uses for the derived role column): these routines
-- update the table directly rather than from inside a trigger, so depth would
-- not distinguish them. A client cannot set the flag — PostgREST exposes no
-- way to call set_config, and no routine here accepts it as input.
-- ===========================================================================

create or replace function public.tg_protect_member_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.status is distinct from old.status
     and (select auth.uid()) is not null
     and coalesce(current_setting('lfghq.moderation', true), '') <> 'on' then
    raise exception
      'Membership status is managed by the moderation routines. Use suspend_member(), unsuspend_member(), ban_member() or unban_member().'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$fn$;

create trigger organization_members_protect_status
  before update of status on public.organization_members
  for each row execute function public.tg_protect_member_status();

-- --- Shared authority check ------------------------------------------------

create or replace function public.assert_can_moderate(p_member_id uuid, p_permission text)
returns public.organization_members
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_member      public.organization_members;
  v_owner_id    uuid;
  v_actor_rank  integer;
  v_target_rank integer;
begin
  select * into v_member from public.organization_members where id = p_member_id;
  if v_member is null then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  -- Cross-organization moderation dies here: the permission is evaluated
  -- against the TARGET's organization, so a caller who is not an effectively
  -- active member of it holds nothing.
  if not public.has_org_permission(v_member.organization_id, p_permission) then
    raise exception 'You do not have permission to moderate members'
      using errcode = 'insufficient_privilege';
  end if;

  if v_member.user_id = (select auth.uid()) then
    raise exception 'You cannot moderate your own membership'
      using errcode = 'insufficient_privilege';
  end if;

  select o.owner_id into v_owner_id
  from public.organizations o where o.id = v_member.organization_id;

  -- Ownership is a column, so this holds however the roles are named.
  if v_member.user_id = v_owner_id then
    raise exception 'The organization owner cannot be moderated. Transfer ownership first.'
      using errcode = 'insufficient_privilege';
  end if;

  v_actor_rank := coalesce(public.my_role_rank(v_member.organization_id), 1000);

  select min(r.rank) into v_target_rank
  from public.member_roles mr
  join public.roles r on r.id = mr.role_id
  where mr.member_id = p_member_id;

  -- The owner (rank -1) may moderate anyone below them. Everyone else needs
  -- strictly more authority than their target.
  if v_actor_rank > -1 and (v_target_rank is null or v_target_rank <= v_actor_rank) then
    raise exception 'You cannot moderate a member whose authority is at or above your own'
      using errcode = 'insufficient_privilege';
  end if;

  return v_member;
end;
$fn$;

revoke execute on function public.assert_can_moderate(uuid, text) from public, anon;

create or replace function public.require_reason(p_reason text)
returns text
language plpgsql
immutable
as $fn$
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required for moderation actions'
      using errcode = 'check_violation';
  end if;
  if char_length(btrim(p_reason)) > 500 then
    raise exception 'Keep the reason under 500 characters' using errcode = 'check_violation';
  end if;
  return btrim(p_reason);
end;
$fn$;

revoke execute on function public.require_reason(text) from public, anon;

-- --- Suspend / unsuspend ---------------------------------------------------

create or replace function public.suspend_member(
  p_member_id uuid,
  p_reason text,
  p_days integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member public.organization_members;
  v_reason text;
  v_until  timestamptz;
begin
  v_member := public.assert_can_moderate(p_member_id, 'members.suspend');
  v_reason := public.require_reason(p_reason);

  if p_days is not null and (p_days < 1 or p_days > 365) then
    raise exception 'A suspension must last between 1 and 365 days'
      using errcode = 'check_violation';
  end if;

  -- NULL means indefinite: is_effectively_active never restores it, so only an
  -- explicit unsuspend ends it.
  v_until := case when p_days is null then null else now() + make_interval(days => p_days) end;

  perform set_config('lfghq.moderation', 'on', true);
  update public.organization_members
  set status            = 'suspended',
      suspended_until   = v_until,
      moderation_reason = v_reason,
      moderated_by      = (select auth.uid()),
      moderated_at      = now()
  where id = p_member_id;
  perform set_config('lfghq.moderation', 'off', true);

  insert into public.moderation_actions
    (organization_id, target_member_id, target_user_id, actor_id, action, reason, expires_at)
  values
    (v_member.organization_id, p_member_id, v_member.user_id, (select auth.uid()),
     'suspend', v_reason, v_until);

  perform public.log_audit_event(
    v_member.organization_id, 'member.suspended', 'member', p_member_id::text,
    case when v_until is null then 'Suspended indefinitely'
         else format('Suspended until %s', to_char(v_until, 'YYYY-MM-DD')) end,
    jsonb_build_object('expires_at', v_until, 'reason', v_reason)
  );
end;
$fn$;

create or replace function public.unsuspend_member(p_member_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member public.organization_members;
begin
  -- Whoever may suspend may also lift a suspension. Bans are heavier and need
  -- members.unban.
  v_member := public.assert_can_moderate(p_member_id, 'members.suspend');

  if v_member.status <> 'suspended' then
    raise exception 'That member is not suspended' using errcode = 'check_violation';
  end if;

  perform set_config('lfghq.moderation', 'on', true);
  update public.organization_members
  set status            = 'active',
      suspended_until   = null,
      moderation_reason = null,
      moderated_by      = (select auth.uid()),
      moderated_at      = now()
  where id = p_member_id;
  perform set_config('lfghq.moderation', 'off', true);

  insert into public.moderation_actions
    (organization_id, target_member_id, target_user_id, actor_id, action, reason)
  values
    (v_member.organization_id, p_member_id, v_member.user_id, (select auth.uid()),
     'unsuspend', nullif(btrim(coalesce(p_reason, '')), ''));

  perform public.log_audit_event(
    v_member.organization_id, 'member.unsuspended', 'member', p_member_id::text,
    'Suspension lifted', '{}'::jsonb
  );
end;
$fn$;

-- --- Ban / unban -----------------------------------------------------------

create or replace function public.ban_member(p_member_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member public.organization_members;
  v_reason text;
begin
  v_member := public.assert_can_moderate(p_member_id, 'members.ban');
  v_reason := public.require_reason(p_reason);

  perform set_config('lfghq.moderation', 'on', true);
  update public.organization_members
  set status            = 'banned',
      -- A ban has no expiry. Clearing this stops a stale timestamp from ever
      -- being mistaken for one.
      suspended_until   = null,
      moderation_reason = v_reason,
      moderated_by      = (select auth.uid()),
      moderated_at      = now()
  where id = p_member_id;
  perform set_config('lfghq.moderation', 'off', true);

  insert into public.moderation_actions
    (organization_id, target_member_id, target_user_id, actor_id, action, reason)
  values
    (v_member.organization_id, p_member_id, v_member.user_id, (select auth.uid()), 'ban', v_reason);

  perform public.log_audit_event(
    v_member.organization_id, 'member.banned', 'member', p_member_id::text,
    'Member banned', jsonb_build_object('reason', v_reason)
  );
end;
$fn$;

create or replace function public.unban_member(p_member_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member public.organization_members;
begin
  v_member := public.assert_can_moderate(p_member_id, 'members.unban');

  if v_member.status <> 'banned' then
    raise exception 'That member is not banned' using errcode = 'check_violation';
  end if;

  perform set_config('lfghq.moderation', 'on', true);
  update public.organization_members
  set status            = 'active',
      suspended_until   = null,
      moderation_reason = null,
      moderated_by      = (select auth.uid()),
      moderated_at      = now()
  where id = p_member_id;
  perform set_config('lfghq.moderation', 'off', true);

  -- Roles are deliberately left exactly as they were. A ban is about access,
  -- not about what someone was hired to do.
  insert into public.moderation_actions
    (organization_id, target_member_id, target_user_id, actor_id, action, reason)
  values
    (v_member.organization_id, p_member_id, v_member.user_id, (select auth.uid()),
     'unban', nullif(btrim(coalesce(p_reason, '')), ''));

  perform public.log_audit_event(
    v_member.organization_id, 'member.unbanned', 'member', p_member_id::text,
    'Ban lifted', '{}'::jsonb
  );
end;
$fn$;

-- --- Grants ----------------------------------------------------------------

revoke execute on function public.suspend_member(uuid, text, integer) from public, anon;
revoke execute on function public.unsuspend_member(uuid, text)        from public, anon;
revoke execute on function public.ban_member(uuid, text)              from public, anon;
revoke execute on function public.unban_member(uuid, text)            from public, anon;

grant execute on function public.suspend_member(uuid, text, integer)  to authenticated;
grant execute on function public.unsuspend_member(uuid, text)         to authenticated;
grant execute on function public.ban_member(uuid, text)               to authenticated;
grant execute on function public.unban_member(uuid, text)             to authenticated;
