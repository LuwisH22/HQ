-- ===========================================================================
-- Phase 4 · Voice — Step 3: being in a room, and being heard in it.
--
-- Step 1 made `channels.view` the whole voice decision, and said plainly that
-- the consequence was that anyone who can see a voice channel can also talk in
-- it. This separates the two, the way the text side has always separated them:
-- `channels.view` is being in the room, `voice.speak` is having a microphone
-- in it — exactly as `channels.view` and `messages.send` divide a text channel.
--
-- It is one row in the catalogue and one column on the answer. There is no new
-- helper, no role name anywhere, and no second ownership rule: `voice.speak`
-- resolves through can_in_channel_for like every other key, so a DENY override
-- on one voice channel makes a role listen-only there and nowhere else, and the
-- owner keeps it because organizations.owner_id already says so.
--
-- Nobody loses anything today. Every role that may speak in text is granted
-- the voice key by the backfill below, so the behaviour of the live
-- organization is unchanged until somebody deliberately takes it away.
--
-- Additive only.
-- ===========================================================================

-- --- 1. The key ------------------------------------------------------------

insert into public.permissions (key, category, label, description, sort_order)
values (
  'voice.speak', 'Chat', 'Speak in voice',
  'Publish a microphone in voice channels. Without it a member can still join and listen.',
  46
)
on conflict (key) do nothing;

-- --- 2. What a new organization starts with --------------------------------
--
-- The same shape as the text keys: everybody who may send messages may speak.
-- Owner already holds every key by construction, and admin is defined as
-- "everything except deleting the organization", but both were materialised as
-- rows at the time they ran — so a key added later has to say so itself.

insert into public.role_template_permissions (role_template_key, permission_key)
values
  ('owner',   'voice.speak'),
  ('admin',   'voice.speak'),
  ('manager', 'voice.speak'),
  ('coach',   'voice.speak'),
  ('player',  'voice.speak'),
  ('staff',   'voice.speak')
on conflict do nothing;

-- --- 3. What every organization that already exists keeps ------------------
--
-- Read from the roles as they actually are rather than from the templates they
-- were made from: a role whose permissions were edited since is still described
-- correctly by what it holds now.

insert into public.role_permissions (role_id, permission_key)
select rp.role_id, 'voice.speak'
from public.role_permissions rp
where rp.permission_key = 'messages.send'
on conflict do nothing;

-- --- 4. The answer gains a column ------------------------------------------
--
-- Dropped rather than replaced: the OUT parameters are part of the signature.

drop function if exists public.voice_room_for(uuid);

create or replace function public.voice_room_for(p_channel_id uuid)
returns table (
  room_name       text,
  channel_id      uuid,
  channel_name    text,
  organization_id uuid,
  can_speak       boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_channel public.channels;
  v_user    uuid := (select auth.uid());
  v_speak   boolean;
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

  -- Being heard is a second question, asked of the same helper, and answered
  -- here rather than by the client: a caller who says they may speak is not
  -- evidence of anything.
  v_speak := public.can_in_channel_for(v_user, p_channel_id, 'voice.speak');

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
    jsonb_build_object('channel', v_channel.name, 'speak', v_speak)
  );

  -- Derived, never supplied. Both halves are uuids this database issued, so
  -- there is no room name a caller can ask for that is not one it is entitled
  -- to be in.
  return query select
    ('lfghq:' || v_channel.organization_id::text || ':voice:' || v_channel.id::text)::text,
    v_channel.id,
    v_channel.name,
    v_channel.organization_id,
    v_speak;
end;
$fn$;

comment on function public.voice_room_for(uuid) is
  'The server-side decision behind a voice session: may this caller be in this voice channel, what is the room called, and may they be heard in it. Inherits can_in_channel_for whole — channels.view to be there, voice.speak to have a microphone — with no new helper, no role names, and no owner special case beyond the one organizations.owner_id already confers.';

revoke execute on function public.voice_room_for(uuid) from public, anon;
grant  execute on function public.voice_room_for(uuid) to authenticated;
