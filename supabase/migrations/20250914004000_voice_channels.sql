-- ===========================================================================
-- Phase 4 · Voice — Step 1: the foundation.
--
-- A voice channel is a channel. C1 left `channels.type` in place with a
-- one-value CHECK and a comment saying voice would widen it; this does that
-- and nothing more. No second table, no second authorization system, no new
-- permission: a voice channel sits in the same categories, obeys the same
-- private/public rule, and is reached through the same
-- can_in_channel_for(user, channel, 'channels.view') that decides every other
-- channel.
--
-- The one new routine, voice_room_for(), is the whole server-side decision
-- behind a voice session. It answers a single question — may this caller be
-- in this voice channel, and if so what is the room called — and the Edge
-- Function that mints LiveKit tokens asks it under the caller's own JWT
-- before it touches a signing key. The room name is derived here, from two
-- uuids, so nothing a client sends can name a room.
--
-- Additive only.
-- ===========================================================================

-- --- 1. The type column widens ---------------------------------------------
--
-- Backward compatible in the only sense that matters: every existing row is
-- 'text' and stays 'text', and the default is unchanged.

alter table public.channels drop constraint if exists channels_type_check;
alter table public.channels
  add constraint channels_type_check check (type in ('text', 'voice'));

comment on column public.channels.type is
  'text or voice. Decides which surface the client opens; carries no authorization meaning of its own — both kinds answer to can_in_channel.';

-- --- 2. Creating one --------------------------------------------------------
--
-- The old five-argument form is replaced rather than shadowed: two bodies
-- differing by one defaulted parameter would eventually disagree.

drop function if exists public.create_channel(uuid, text, text, uuid, boolean);

create or replace function public.create_channel(
  p_organization_id uuid,
  p_name text,
  p_topic text default null,
  p_category_id uuid default null,
  p_is_private boolean default false,
  p_type text default 'text'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key  text;
  v_id   uuid;
  v_type text := coalesce(nullif(btrim(p_type), ''), 'text');
begin
  if not public.has_org_permission(p_organization_id, 'channels.create') then
    raise exception 'You do not have permission to create channels'
      using errcode = 'insufficient_privilege';
  end if;

  -- Checked here as well as by the constraint, so the refusal reads as a
  -- sentence rather than as a constraint violation.
  if v_type not in ('text', 'voice') then
    raise exception 'A channel is either text or voice' using errcode = 'check_violation';
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
    (organization_id, category_id, key, name, topic, position, is_private, type, created_by)
  values (
    p_organization_id, p_category_id, v_key, btrim(p_name), nullif(btrim(coalesce(p_topic, '')), ''),
    coalesce((select max(position) + 1 from public.channels
              where organization_id = p_organization_id), 0),
    coalesce(p_is_private, false),
    v_type,
    (select auth.uid())
  )
  returning id into v_id;

  perform public.log_audit_event(
    p_organization_id, 'channel.created', 'channel', v_id::text,
    format('Channel %s created', btrim(p_name)),
    jsonb_build_object('name', btrim(p_name), 'private', coalesce(p_is_private, false),
                       'type', v_type)
  );
  return v_id;
end;
$fn$;

comment on function public.create_channel(uuid, text, text, uuid, boolean, text) is
  'Creates a text or voice channel. Requires channels.create; the slug is derived and carries no authorization meaning.';

drop function if exists public.create_channel_in_category(uuid, text, text, boolean);

create or replace function public.create_channel_in_category(
  p_organization_id uuid,
  p_name text,
  p_category_name text default null,
  p_is_private boolean default false,
  p_type text default 'text'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_category_name text := nullif(btrim(coalesce(p_category_name, '')), '');
  v_category_id   uuid;
begin
  -- Checked here as well as inside create_channel, so that the lookup below
  -- runs only for someone already entitled to be creating channels in this
  -- organization. Without it, a caller could tell whether a category name
  -- exists elsewhere by which of two refusals came back.
  if not public.has_org_permission(p_organization_id, 'channels.create') then
    raise exception 'You do not have permission to create channels'
      using errcode = 'insufficient_privilege';
  end if;

  if v_category_name is not null then
    -- Reuse rather than duplicate. Case-insensitive, because "Competitive"
    -- and "competitive" are one section to everyone reading the sidebar, and
    -- two identically named cards would be a puzzle rather than a choice.
    select id into v_category_id
    from public.channel_categories
    where organization_id = p_organization_id
      and lower(name) = lower(v_category_name)
    order by position, created_at
    limit 1;

    -- Creating a category is a stronger permission than creating a channel.
    -- Someone who may only create channels can still file one under a section
    -- that exists; naming a new one is refused, and takes the channel with it.
    if v_category_id is null then
      v_category_id := public.create_category(p_organization_id, v_category_name);
    end if;
  end if;

  return public.create_channel(
    p_organization_id, p_name, null, v_category_id, coalesce(p_is_private, false), p_type
  );
end;
$fn$;

comment on function public.create_channel_in_category(uuid, text, text, boolean, text) is
  'Creates a channel and, when named and absent, the category holding it — atomically. Delegates to create_category and create_channel; adds no rules of its own.';

-- --- 3. The whole decision behind a voice session ---------------------------
--
-- SECURITY DEFINER for one reason: it writes an audit row, and
-- log_audit_event is revoked from `authenticated` precisely so that only a
-- routine like this one can. Because it is definer, it must decide visibility
-- itself rather than lean on RLS — which it does with the same helper every
-- other channel read leans on, and it refuses a channel it cannot see and a
-- channel that does not exist with one indistinguishable answer, so the id
-- space stays opaque.
--
-- No new permission. `channels.view` on a voice channel means the same thing
-- it means on a text channel: this room is yours to be in. That check already
-- carries the effective-active gate (a suspended or banned member reaches
-- nothing), ownership from organizations.owner_id, DENY > ALLOW > INHERIT,
-- and the private-channel allow-list, and it resolves membership against the
-- channel's own organization — so a channel id from another organization is
-- refused by construction rather than by a separate rule.

create or replace function public.voice_room_for(p_channel_id uuid)
returns table (
  room_name       text,
  channel_id      uuid,
  channel_name    text,
  organization_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_channel public.channels;
  v_user    uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_channel from public.channels where id = p_channel_id;

  -- One refusal for "no such channel", "not a voice channel" and "not yours".
  -- Three different sentences would let somebody map the id space by asking.
  if v_channel is null
     or v_channel.type <> 'voice'
     or v_channel.archived_at is not null
     or not public.can_in_channel_for(v_user, p_channel_id, 'channels.view')
  then
    raise exception 'You do not have access to that voice channel'
      using errcode = 'insufficient_privilege';
  end if;

  -- One row per grant of access. Not per mute, not per speaking change, not
  -- per network blip: those are LiveKit's business for the length of a
  -- session, and writing them here would be a storm describing nothing.
  --
  -- There is deliberately no voice.leave. A server can vouch for having let
  -- somebody in; it cannot vouch for a client's claim to have left, and a
  -- crashed tab never makes the claim at all.
  perform public.log_audit_event(
    v_channel.organization_id, 'voice.join', 'channel', v_channel.id::text,
    format('Joined voice in %s', v_channel.name),
    jsonb_build_object('channel', v_channel.name)
  );

  -- Derived, never supplied. Both halves are uuids this database issued, so
  -- there is no room name a caller can ask for that is not one it is entitled
  -- to be in.
  return query select
    ('lfghq:' || v_channel.organization_id::text || ':voice:' || v_channel.id::text)::text,
    v_channel.id,
    v_channel.name,
    v_channel.organization_id;
end;
$fn$;

comment on function public.voice_room_for(uuid) is
  'The server-side decision behind a voice session: may this caller be in this voice channel, and what is the room called. Inherits can_in_channel_for(channels.view) whole — no new permission, no role names, no owner special case beyond the one organizations.owner_id already confers.';

revoke execute on function public.voice_room_for(uuid) from public, anon;
grant  execute on function public.voice_room_for(uuid) to authenticated;

revoke execute on function public.create_channel(uuid, text, text, uuid, boolean, text)
  from public, anon;
grant  execute on function public.create_channel(uuid, text, text, uuid, boolean, text)
  to authenticated;

revoke execute on function public.create_channel_in_category(uuid, text, text, boolean, text)
  from public, anon;
grant  execute on function public.create_channel_in_category(uuid, text, text, boolean, text)
  to authenticated;
