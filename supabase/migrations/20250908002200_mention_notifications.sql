-- ===========================================================================
-- LFG HQ · Phase 2 · C2 · Asking the question about somebody else
--
-- `can_in_channel` and `has_org_permission` both read auth.uid() internally,
-- so there has been no way to ask "can THIS OTHER member see this channel".
-- That blocked two things: an accurate member list for a private channel, and
-- mention notifications — because telling someone they were mentioned in a
-- channel they cannot see leaks the channel's name and the existence of a
-- message in it.
--
-- The fix is an extraction, not a rule change. Each function's body is moved
-- verbatim into a `_for(p_user_id, ...)` variant with `(select auth.uid())`
-- replaced by the parameter, and the original is redefined as a one-line
-- delegation passing auth.uid(). Deny > Allow > Inherit, the ownership
-- short-circuit, the effective-active gate and role semantics are untouched —
-- the existing live authorization matrix must pass unchanged, and is the
-- proof.
--
-- has_org_permission is extracted too. Step 6 of can_in_channel delegates to
-- it, so leaving it caller-scoped would have meant copying its body into
-- can_in_channel_for — two implementations of the same rule, free to drift.
-- One implementation is the point of the exercise.
--
-- ROLLBACK. Restore the two originals verbatim:
--   has_org_permission — supabase/migrations/20250902000300_dynamic_role_authz.sql
--   can_in_channel     — supabase/migrations/20250904001200_channel_authz.sql
-- then `drop function` the three functions and the trigger added here. No
-- table, column or policy is changed by this file.
--
-- Additive only.
-- ===========================================================================

-- --- Organization-level permission, for any member -------------------------
-- Body copied verbatim from 20250902000300; every `(select auth.uid())`
-- became `p_user_id`. Note `status = 'active'` is the literal check the
-- original used, not is_effectively_active — preserved exactly, including
-- that asymmetry.

create or replace function public.has_org_permission_for(
  p_user_id uuid,
  p_organization_id uuid,
  p_permission text
)
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
       and m.user_id = p_user_id
       and m.status = 'active'
      where o.id = p_organization_id
        and o.owner_id = p_user_id
    )
    or exists (
      select 1
      from public.organization_members m
      join public.member_roles mr on mr.member_id = m.id
      join public.role_permissions rp on rp.role_id = mr.role_id
      where m.organization_id = p_organization_id
        and m.user_id = p_user_id
        and m.status = 'active'
        and rp.permission_key = p_permission
    );
$fn$;

comment on function public.has_org_permission_for is
  'Authoritative permission check for a named member. has_org_permission is this function with auth.uid() supplied.';

create or replace function public.has_org_permission(
  p_organization_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_org_permission_for(
    (select auth.uid()), p_organization_id, p_permission
  );
$fn$;

comment on function public.has_org_permission is
  'Authoritative permission check. The owner implicitly holds everything, so no permission edit can lock them out of their own organization.';

-- --- Channel-level permission, for any member ------------------------------
-- Body copied verbatim from 20250904001200; every `(select auth.uid())`
-- became `p_user_id`. The numbered steps are the original comments.

create or replace function public.can_in_channel_for(
  p_user_id uuid,
  p_channel_id uuid,
  p_permission text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_channel  public.channels;
  v_member   public.organization_members;
  v_owner_id uuid;
begin
  if p_user_id is null then
    return false;
  end if;

  select * into v_channel from public.channels where id = p_channel_id;
  if v_channel is null then
    return false;
  end if;

  -- 1. Moderation is the first gate: a suspended or banned member reaches
  --    nothing, whatever their roles or overrides say.
  select * into v_member
  from public.organization_members
  where organization_id = v_channel.organization_id
    and user_id = p_user_id;

  if v_member is null then
    return false;
  end if;
  if not public.is_effectively_active(v_member.status, v_member.suspended_until) then
    return false;
  end if;

  -- 2. Ownership comes from the organization, never from a role or an override.
  select owner_id into v_owner_id
  from public.organizations where id = v_channel.organization_id;
  if v_owner_id = p_user_id then
    return true;
  end if;

  -- 3. Deny wins outright.
  if exists (
    select 1
    from public.channel_permission_overrides o
    join public.member_roles mr on mr.role_id = o.role_id
    where o.channel_id = p_channel_id
      and o.permission_key = p_permission
      and o.effect = 'deny'
      and mr.member_id = v_member.id
  ) then
    return false;
  end if;

  -- 4. Then allow.
  if exists (
    select 1
    from public.channel_permission_overrides o
    join public.member_roles mr on mr.role_id = o.role_id
    where o.channel_id = p_channel_id
      and o.permission_key = p_permission
      and o.effect = 'allow'
      and mr.member_id = v_member.id
  ) then
    return true;
  end if;

  -- 5. A private channel is an allow-list. Without an explicit ALLOW there is
  --    nothing to inherit, so guessing the id gains nothing.
  if v_channel.is_private then
    return false;
  end if;

  -- 6. Inherit the organization-level answer.
  return public.has_org_permission_for(
    p_user_id, v_channel.organization_id, p_permission
  );
end;
$fn$;

comment on function public.can_in_channel_for is
  'Channel-scoped authorization for a named member. Deny > Allow > Inherit, behind the B2 effective-active gate. can_in_channel is this function with auth.uid() supplied.';

create or replace function public.can_in_channel(p_channel_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.can_in_channel_for((select auth.uid()), p_channel_id, p_permission);
$fn$;

comment on function public.can_in_channel is
  'Channel-scoped authorization. Deny > Allow > Inherit, behind the B2 effective-active gate. Overrides read here are never visible to has_org_permission.';

revoke execute on function public.has_org_permission_for(uuid, uuid, text) from public, anon;
revoke execute on function public.can_in_channel_for(uuid, uuid, text) from public, anon;
grant execute on function public.has_org_permission_for(uuid, uuid, text) to authenticated;
grant execute on function public.can_in_channel_for(uuid, uuid, text) to authenticated;

-- --- Who can actually see this channel -------------------------------------

create or replace function public.channel_member_ids(p_channel_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
begin
  -- You must be able to see the channel before you may ask who else can.
  -- Returning nothing rather than raising keeps a guessed id indistinguishable
  -- from an empty channel.
  if not public.can_in_channel(p_channel_id, 'channels.view') then
    return;
  end if;

  select organization_id into v_org from public.channels where id = p_channel_id;

  return query
    select m.user_id
    from public.organization_members m
    where m.organization_id = v_org
      and public.can_in_channel_for(m.user_id, p_channel_id, 'channels.view');
end;
$fn$;

comment on function public.channel_member_ids is
  'The members who can actually see a channel, resolved through the same rules that govern the channel itself. Empty for a caller who cannot see it.';

revoke execute on function public.channel_member_ids(uuid) from public, anon;
grant execute on function public.channel_member_ids(uuid) to authenticated;

-- --- Mentions --------------------------------------------------------------
-- The gate is can_in_channel_for: a notification is written only for someone
-- who could have read the message anyway. Everything else here is text
-- handling.

create or replace function public.tg_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_channel public.channels;
  v_actor   uuid := new.author_id;
  v_name    text;
  v_handle  text;
  v_target  uuid;
begin
  if new.deleted_at is not null or coalesce(new.body, '') = '' then
    return null;
  end if;

  select * into v_channel from public.channels where id = new.channel_id;
  if v_channel is null then
    return null;
  end if;

  select coalesce(p.display_name, p.full_name, p.email) into v_name
  from public.profiles p where p.id = v_actor;

  for v_handle in
    select distinct lower(m[1])
    from regexp_matches(new.body, '@([A-Za-z0-9._-]{2,40})', 'g') as m
  loop
    -- A handle is a display name or the local part of the sign-in address.
    -- Ambiguity resolves to nobody rather than to a guess.
    select p.id into v_target
    from public.profiles p
    join public.organization_members om
      on om.user_id = p.id
     and om.organization_id = v_channel.organization_id
    where lower(coalesce(p.display_name, '')) = v_handle
       or lower(split_part(p.email, '@', 1)) = v_handle
    limit 1;

    if v_target is null or v_target = v_actor then
      continue;
    end if;

    -- The whole reason this migration exists.
    if not public.can_in_channel_for(v_target, new.channel_id, 'channels.view') then
      continue;
    end if;

    insert into public.notifications (
      organization_id, recipient_id, type, entity_type, entity_id,
      actor_id, summary, metadata
    )
    values (
      v_channel.organization_id,
      v_target,
      'mention',
      'message',
      new.id::text,
      v_actor,
      left(format('%s mentioned you in #%s', coalesce(v_name, 'Someone'), v_channel.name), 300),
      jsonb_build_object(
        'channel_id', new.channel_id,
        'channel_key', v_channel.key,
        'channel_name', v_channel.name,
        -- Safe to carry: this row only exists for someone who passed the
        -- check above and could therefore read the message itself.
        'excerpt', left(new.body, 160)
      )
    );
  end loop;

  return null;
end;
$fn$;

-- INSERT only. Editing a message to add a mention deliberately does not
-- notify: it would need its own dedupe, and C2 is not the place for it.
create trigger messages_mentions
  after insert on public.messages
  for each row execute function public.tg_message_mentions();
