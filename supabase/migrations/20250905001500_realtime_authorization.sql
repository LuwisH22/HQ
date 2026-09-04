-- ===========================================================================
-- LFG HQ · Phase 2 · C1 · Realtime authorization for channel topics
--
-- Typing indicators are ephemeral Broadcast events: nothing about them is
-- stored, and there is no table and no permission for them. But "not stored"
-- must not mean "not authorized" — a member who cannot see #management should
-- not learn that somebody is typing in it.
--
-- Supabase Realtime enforces RLS on `realtime.messages` for channels opened
-- with `private: true`. The client opens one topic per chat channel, named
-- `channel:<uuid>`, and carries both the Postgres Changes stream and the
-- typing broadcasts on it. The policies below decide who may join that topic
-- and who may broadcast into it, using the same `can_in_channel` resolver that
-- governs every other channel decision.
--
-- Postgres Changes are filtered separately, by the RLS on `public.messages`
-- itself, so a subscriber only ever receives rows it could have selected.
--
-- Additive only. No table, no permission, no stored typing state.
-- ===========================================================================

create or replace function public.can_join_channel_topic(p_topic text, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_channel_id uuid;
begin
  -- Topics are `channel:<uuid>`. Anything else is not ours to authorize.
  if p_topic is null or split_part(p_topic, ':', 1) <> 'channel' then
    return false;
  end if;

  -- A malformed id is a refusal, never an exception: raising here would let a
  -- caller distinguish "bad format" from "no access" by the error they get.
  begin
    v_channel_id := split_part(p_topic, ':', 2)::uuid;
  exception when others then
    return false;
  end;

  return public.can_in_channel(v_channel_id, p_permission);
end;
$fn$;

comment on function public.can_join_channel_topic is
  'Maps a realtime topic name onto the channel it belongs to and defers to can_in_channel. Returns false for anything unparseable rather than raising.';

revoke execute on function public.can_join_channel_topic(text, text) from public, anon;
grant execute on function public.can_join_channel_topic(text, text) to authenticated;

-- --- Realtime policies -----------------------------------------------------
-- Reading the topic means receiving typing events; writing means emitting
-- them. Both require being able to view the channel, which already implies an
-- effectively active membership — suspended and banned members resolve to
-- false inside can_in_channel and therefore cannot participate at all.

drop policy if exists "Members can receive channel realtime events" on realtime.messages;
create policy "Members can receive channel realtime events"
  on realtime.messages for select to authenticated
  using (public.can_join_channel_topic((select realtime.topic()), 'channels.view'));

-- Emitting a typing event is gated on `messages.send` rather than
-- `channels.view`: someone who may read a channel but not post in it has
-- nothing to announce, and a deny override on messages.send should silence the
-- indicator too.
drop policy if exists "Members can emit channel realtime events" on realtime.messages;
create policy "Members can emit channel realtime events"
  on realtime.messages for insert to authenticated
  with check (public.can_join_channel_topic((select realtime.topic()), 'messages.send'));
