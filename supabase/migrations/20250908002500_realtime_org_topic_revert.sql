-- ===========================================================================
-- LFG HQ · Phase 2 · C2 · The organization topic does not need to be private
--
-- Two migrations tried to make `org:<uuid>` a *private* realtime topic, and
-- Realtime refused the join both times — with can_join_org_topic returning
-- true for the exact topic string when called directly, and with the write
-- policy widened to match. The cause is inside Realtime's own authorization
-- path, not in this schema, and chasing it further buys nothing: the topic
-- does not need to be private in the first place.
--
-- It carries Postgres Changes and nothing else. No broadcast, no presence.
-- Row delivery for Postgres Changes is filtered by RLS per subscriber — the
-- same mechanism C1 already relies on for `messages` — so a member receives
-- only messages they could have read and only notifications addressed to
-- them, whoever else can join the topic by name. Topic-level gating would
-- have been defence in depth over a control that is already sufficient.
--
-- So both policies go back to exactly what 20250905001500 created, and
-- can_join_org_topic goes with them rather than staying as a function nothing
-- calls.
--
-- ROLLBACK. There is nothing to roll back to: this restores the C1 state.
-- ===========================================================================

drop policy if exists "Members can receive channel realtime events" on realtime.messages;
create policy "Members can receive channel realtime events"
  on realtime.messages for select to authenticated
  using (public.can_join_channel_topic((select realtime.topic()), 'channels.view'));

-- Emitting is gated on `messages.send` rather than `channels.view`: someone
-- who may read a channel but not post in it has nothing to announce, and a
-- deny override on messages.send should silence the indicator too.
drop policy if exists "Members can emit channel realtime events" on realtime.messages;
create policy "Members can emit channel realtime events"
  on realtime.messages for insert to authenticated
  with check (public.can_join_channel_topic((select realtime.topic()), 'messages.send'));

drop function if exists public.can_join_org_topic(text, text);
