-- ===========================================================================
-- LFG HQ · Phase 1.5 · B3 · Channel authorization
--
-- Resolution order, applied by can_in_channel() and by nothing else:
--
--   1. effectively active member of the channel's organization?  no  -> denied
--   2. owner of that organization?                               yes -> allowed
--   3. any role the member holds has DENY on this channel?        yes -> denied
--   4. any role the member holds has ALLOW on this channel?       yes -> allowed
--   5. the channel is private?                                   yes -> denied
--   6. otherwise inherit has_org_permission()
--
-- Deny beats Allow beats Inherit. Because a member may hold several roles
-- (B1), a single DENY from any one of them is enough — the safer default.
--
-- WHY THESE ARE SECURITY DEFINER. The policy on `channels` has to read
-- `channel_permission_overrides`, and the policy on the overrides has to know
-- which organization a channel belongs to. If those policies referenced each
-- other's tables directly, PostgreSQL would recurse without end. Routing both
-- through SECURITY DEFINER helpers — which do not re-enter RLS — breaks the
-- cycle. It is the same shape `is_org_member` has used since Phase 1.
--
-- SCOPE. An override row is read here and nowhere else. `has_org_permission`
-- and `my_permissions` never touch that table, so a channel-local ALLOW cannot
-- become an organization-wide grant, and a channel-local DENY cannot remove
-- one. The separation is structural rather than a matter of careful querying.
-- ===========================================================================

create or replace function public.channel_organization(p_channel_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select organization_id from public.channels where id = p_channel_id;
$fn$;

revoke execute on function public.channel_organization(uuid) from public, anon;
grant execute on function public.channel_organization(uuid) to authenticated;

create or replace function public.can_in_channel(p_channel_id uuid, p_permission text)
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
  select * into v_channel from public.channels where id = p_channel_id;
  if v_channel is null then
    return false;
  end if;

  -- 1. Moderation is the first gate: a suspended or banned member reaches
  --    nothing, whatever their roles or overrides say.
  select * into v_member
  from public.organization_members
  where organization_id = v_channel.organization_id
    and user_id = (select auth.uid());

  if v_member is null then
    return false;
  end if;
  if not public.is_effectively_active(v_member.status, v_member.suspended_until) then
    return false;
  end if;

  -- 2. Ownership comes from the organization, never from a role or an override.
  select owner_id into v_owner_id
  from public.organizations where id = v_channel.organization_id;
  if v_owner_id = (select auth.uid()) then
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
  return public.has_org_permission(v_channel.organization_id, p_permission);
end;
$fn$;

comment on function public.can_in_channel is
  'Channel-scoped authorization. Deny > Allow > Inherit, behind the B2 effective-active gate. Overrides read here are never visible to has_org_permission.';

revoke execute on function public.can_in_channel(uuid, text) from public, anon;
grant execute on function public.can_in_channel(uuid, text) to authenticated;

-- A category is worth showing when it holds something the caller can see, or
-- when they are the person who arranges categories in the first place.
create or replace function public.can_see_category(p_category_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
  v_channel_id uuid;
begin
  select organization_id into v_org
  from public.channel_categories where id = p_category_id;
  if v_org is null then
    return false;
  end if;

  if not public.is_org_member(v_org) then
    return false;
  end if;

  if public.has_org_permission(v_org, 'channels.manage') then
    return true;
  end if;

  -- Otherwise the category is only visible through its contents, so an empty
  -- private section does not advertise its own name.
  for v_channel_id in
    select id from public.channels where category_id = p_category_id
  loop
    if public.can_in_channel(v_channel_id, 'channels.view') then
      return true;
    end if;
  end loop;

  return false;
end;
$fn$;

revoke execute on function public.can_see_category(uuid) from public, anon;
grant execute on function public.can_see_category(uuid) to authenticated;

-- --- RLS -------------------------------------------------------------------
-- Read policies only. Every write goes through the routines below, which
-- audit and enforce hierarchy; there is deliberately no client write policy on
-- any of the three tables.

alter table public.channel_categories enable row level security;
alter table public.channels enable row level security;
alter table public.channel_permission_overrides enable row level security;

create policy "Members can read categories they can see into"
  on public.channel_categories for select to authenticated
  using (public.can_see_category(id));

create policy "Members can read channels they may view"
  on public.channels for select to authenticated
  using (public.can_in_channel(id, 'channels.view'));

create policy "Permission managers can read channel overrides"
  on public.channel_permission_overrides for select to authenticated
  using (
    public.has_org_permission(
      public.channel_organization(channel_id),
      'channels.permissions_manage'
    )
  );

revoke all on public.channel_categories from anon;
revoke all on public.channels from anon;
revoke all on public.channel_permission_overrides from anon;

grant select on public.channel_categories to authenticated;
grant select on public.channels to authenticated;
grant select on public.channel_permission_overrides to authenticated;

-- --- Shared checks ---------------------------------------------------------

create or replace function public.assert_can_manage_channels(p_organization_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.has_org_permission(p_organization_id, 'channels.manage') then
    raise exception 'You do not have permission to manage channels'
      using errcode = 'insufficient_privilege';
  end if;
end;
$fn$;

revoke execute on function public.assert_can_manage_channels(uuid) from public, anon;

-- --- Categories ------------------------------------------------------------

create or replace function public.create_category(p_organization_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  perform public.assert_can_manage_channels(p_organization_id);

  insert into public.channel_categories (organization_id, name, position, created_by)
  values (
    p_organization_id,
    btrim(p_name),
    coalesce((select max(position) + 1 from public.channel_categories
              where organization_id = p_organization_id), 0),
    (select auth.uid())
  )
  returning id into v_id;

  perform public.log_audit_event(
    p_organization_id, 'category.created', 'channel_category', v_id::text,
    format('Category %s created', btrim(p_name)), jsonb_build_object('name', btrim(p_name))
  );
  return v_id;
end;
$fn$;

create or replace function public.update_category(p_category_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_category public.channel_categories;
begin
  select * into v_category from public.channel_categories where id = p_category_id;
  if v_category is null then
    raise exception 'Category not found' using errcode = 'no_data_found';
  end if;
  perform public.assert_can_manage_channels(v_category.organization_id);

  update public.channel_categories set name = btrim(p_name) where id = p_category_id;

  perform public.log_audit_event(
    v_category.organization_id, 'category.updated', 'channel_category', p_category_id::text,
    format('Category renamed to %s', btrim(p_name)),
    jsonb_build_object('before', v_category.name, 'after', btrim(p_name))
  );
end;
$fn$;

create or replace function public.delete_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_category public.channel_categories;
begin
  select * into v_category from public.channel_categories where id = p_category_id;
  if v_category is null then
    raise exception 'Category not found' using errcode = 'no_data_found';
  end if;
  perform public.assert_can_manage_channels(v_category.organization_id);

  -- Channels survive: the FK is ON DELETE SET NULL, so they become
  -- uncategorised rather than disappearing with their section.
  perform public.log_audit_event(
    v_category.organization_id, 'category.deleted', 'channel_category', p_category_id::text,
    format('Category %s deleted', v_category.name), jsonb_build_object('name', v_category.name)
  );

  delete from public.channel_categories where id = p_category_id;
end;
$fn$;

create or replace function public.reorder_categories(p_organization_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.assert_can_manage_channels(p_organization_id);

  -- One statement: there is no read-then-write window for two reorders to
  -- interleave in.
  update public.channel_categories c
  set position = t.ord
  from unnest(p_ids) with ordinality as t(id, ord)
  where c.id = t.id and c.organization_id = p_organization_id;
end;
$fn$;

-- --- Channels --------------------------------------------------------------

create or replace function public.create_channel(
  p_organization_id uuid,
  p_name text,
  p_topic text default null,
  p_category_id uuid default null,
  p_is_private boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text;
  v_id  uuid;
begin
  if not public.has_org_permission(p_organization_id, 'channels.create') then
    raise exception 'You do not have permission to create channels'
      using errcode = 'insufficient_privilege';
  end if;

  -- The key is a URL slug and nothing more. No authorization logic reads it,
  -- exactly as with roles.key.
  v_key := lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]+', '-', 'g'));
  v_key := regexp_replace(v_key, '^[^a-z]+', '');
  v_key := regexp_replace(v_key, '-+$', '');
  if v_key = '' then
    v_key := 'channel';
  end if;
  v_key := left(v_key, 28) || '-' || substr(md5(gen_random_uuid()::text), 1, 8);

  insert into public.channels
    (organization_id, category_id, key, name, topic, position, is_private, created_by)
  values (
    p_organization_id, p_category_id, v_key, btrim(p_name), nullif(btrim(coalesce(p_topic, '')), ''),
    coalesce((select max(position) + 1 from public.channels
              where organization_id = p_organization_id), 0),
    coalesce(p_is_private, false),
    (select auth.uid())
  )
  returning id into v_id;

  perform public.log_audit_event(
    p_organization_id, 'channel.created', 'channel', v_id::text,
    format('Channel %s created', btrim(p_name)),
    jsonb_build_object('name', btrim(p_name), 'private', coalesce(p_is_private, false))
  );
  return v_id;
end;
$fn$;

create or replace function public.update_channel(
  p_channel_id uuid,
  p_name text default null,
  p_topic text default null,
  p_category_id uuid default null,
  p_is_private boolean default null,
  p_archived boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_channel public.channels;
begin
  select * into v_channel from public.channels where id = p_channel_id;
  if v_channel is null then
    raise exception 'Channel not found' using errcode = 'no_data_found';
  end if;
  perform public.assert_can_manage_channels(v_channel.organization_id);

  -- You cannot rearrange what you are not allowed to see.
  if not public.can_in_channel(p_channel_id, 'channels.view') then
    raise exception 'You do not have access to that channel'
      using errcode = 'insufficient_privilege';
  end if;

  update public.channels
  set name        = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
      topic       = case when p_topic is null then topic
                         else nullif(btrim(p_topic), '') end,
      category_id = case when p_category_id is null then category_id else p_category_id end,
      is_private  = coalesce(p_is_private, is_private),
      archived_at = case
                      when p_archived is null then archived_at
                      when p_archived then coalesce(archived_at, now())
                      else null
                    end
  where id = p_channel_id;

  perform public.log_audit_event(
    v_channel.organization_id,
    case when p_archived is true then 'channel.archived'
         when p_archived is false then 'channel.restored'
         else 'channel.updated' end,
    'channel', p_channel_id::text,
    format('Channel %s updated', v_channel.name),
    jsonb_build_object('before', jsonb_build_object(
      'name', v_channel.name, 'private', v_channel.is_private,
      'archived', v_channel.archived_at is not null))
  );
end;
$fn$;

-- Deliberately separate, and deliberately heavier than archiving.
create or replace function public.delete_channel(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_channel public.channels;
begin
  select * into v_channel from public.channels where id = p_channel_id;
  if v_channel is null then
    raise exception 'Channel not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_channel.organization_id, 'channels.delete') then
    raise exception 'You do not have permission to delete channels'
      using errcode = 'insufficient_privilege';
  end if;

  -- Authority check: a private channel you cannot even see is not yours to
  -- destroy.
  if not public.can_in_channel(p_channel_id, 'channels.view') then
    raise exception 'You do not have access to that channel'
      using errcode = 'insufficient_privilege';
  end if;

  -- Recorded before the row disappears, so the trail survives the channel.
  -- When Phase 2 adds messages they will hang off channel_id ON DELETE
  -- CASCADE; that is why this needs its own permission rather than riding
  -- along with channels.manage.
  perform public.log_audit_event(
    v_channel.organization_id, 'channel.deleted', 'channel', p_channel_id::text,
    format('Channel %s permanently deleted', v_channel.name),
    jsonb_build_object('name', v_channel.name, 'private', v_channel.is_private)
  );

  delete from public.channels where id = p_channel_id;
end;
$fn$;

create or replace function public.reorder_channels(p_organization_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.assert_can_manage_channels(p_organization_id);

  update public.channels c
  set position = t.ord
  from unnest(p_ids) with ordinality as t(id, ord)
  where c.id = t.id and c.organization_id = p_organization_id;
end;
$fn$;

-- --- Overrides -------------------------------------------------------------

create or replace function public.set_channel_override(
  p_channel_id uuid,
  p_role_id uuid,
  p_permission_key text,
  -- NULL clears the override, returning that role to inherit.
  p_effect public.override_effect default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_channel    public.channels;
  v_role       public.roles;
  v_actor_rank integer;
begin
  select * into v_channel from public.channels where id = p_channel_id;
  if v_channel is null then
    raise exception 'Channel not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_channel.organization_id, 'channels.permissions_manage') then
    raise exception 'You do not have permission to manage channel permissions'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.can_in_channel(p_channel_id, 'channels.view') then
    raise exception 'You do not have access to that channel'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_role from public.roles where id = p_role_id;
  if v_role is null or v_role.organization_id <> v_channel.organization_id then
    raise exception 'That role belongs to a different organization'
      using errcode = 'check_violation';
  end if;

  -- Hierarchy: you may only alter the access of roles strictly below your own
  -- authority. Without this, a manager could deny an administrator, or grant
  -- a role above them a way in.
  v_actor_rank := coalesce(public.my_role_rank(v_channel.organization_id), 1000);
  if v_actor_rank > -1 and v_role.rank <= v_actor_rank then
    raise exception 'You can only change access for roles below your own authority'
      using errcode = 'insufficient_privilege';
  end if;

  -- Delegation: you cannot hand out a capability you do not hold. Mirrors the
  -- rule role_permissions has enforced since B1.
  if p_effect = 'allow'
     and not public.has_org_permission(v_channel.organization_id, p_permission_key) then
    raise exception 'You cannot grant a permission you do not hold: %', p_permission_key
      using errcode = 'insufficient_privilege';
  end if;

  if p_effect is null then
    delete from public.channel_permission_overrides
    where channel_id = p_channel_id and role_id = p_role_id and permission_key = p_permission_key;
  else
    insert into public.channel_permission_overrides
      (channel_id, role_id, permission_key, effect, created_by)
    values (p_channel_id, p_role_id, p_permission_key, p_effect, (select auth.uid()))
    on conflict (channel_id, role_id, permission_key)
    do update set effect = excluded.effect, created_by = excluded.created_by;
  end if;

  perform public.log_audit_event(
    v_channel.organization_id, 'channel.permission_changed', 'channel', p_channel_id::text,
    format('%s on %s for %s', p_permission_key, v_channel.name, v_role.name),
    jsonb_build_object('role', v_role.name, 'permission', p_permission_key,
                       'effect', coalesce(p_effect::text, 'inherit'))
  );
end;
$fn$;

-- --- Grants ----------------------------------------------------------------

revoke execute on function public.create_category(uuid, text)                       from public, anon;
revoke execute on function public.update_category(uuid, text)                       from public, anon;
revoke execute on function public.delete_category(uuid)                             from public, anon;
revoke execute on function public.reorder_categories(uuid, uuid[])                  from public, anon;
revoke execute on function public.create_channel(uuid, text, text, uuid, boolean)   from public, anon;
revoke execute on function public.update_channel(uuid, text, text, uuid, boolean, boolean)
                                                                                    from public, anon;
revoke execute on function public.delete_channel(uuid)                              from public, anon;
revoke execute on function public.reorder_channels(uuid, uuid[])                    from public, anon;
revoke execute on function public.set_channel_override(uuid, uuid, text, public.override_effect)
                                                                                    from public, anon;

grant execute on function public.create_category(uuid, text)                        to authenticated;
grant execute on function public.update_category(uuid, text)                        to authenticated;
grant execute on function public.delete_category(uuid)                              to authenticated;
grant execute on function public.reorder_categories(uuid, uuid[])                   to authenticated;
grant execute on function public.create_channel(uuid, text, text, uuid, boolean)    to authenticated;
grant execute on function public.update_channel(uuid, text, text, uuid, boolean, boolean)
                                                                                    to authenticated;
grant execute on function public.delete_channel(uuid)                               to authenticated;
grant execute on function public.reorder_channels(uuid, uuid[])                     to authenticated;
grant execute on function public.set_channel_override(uuid, uuid, text, public.override_effect)
                                                                                    to authenticated;
