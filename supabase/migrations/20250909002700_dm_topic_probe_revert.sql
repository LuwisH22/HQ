-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · Reverting the throwaway probe
--
-- Restores both realtime.messages policies verbatim from
-- supabase/migrations/20250908002500_realtime_org_topic_revert.sql and drops
-- every function the probe added, including can_join_org_topic — which the
-- probe recreated only to replay C2's exact shape, and which C2 had already
-- dropped.
--
-- Net schema effect of 20250909002600 + 20250909002610 + this file: zero.
--
-- WHAT THE PROBE FOUND, recorded here because it corrects the record:
--
--   1. a private `channel:<uuid>` topic joins            SUBSCRIBED
--   2. a private `dm:<uuid>` topic the policy permits    SUBSCRIBED
--   3. a private `dm:<uuid>` the policy refuses          CHANNEL_ERROR
--   4. broadcast round-trips on it                       received
--   5. a NEW prefix authorized by reading tables         SUBSCRIBED
--   6. C2's org: topic and function, replayed exactly    SUBSCRIBED
--
-- Line 6 is the correction. C2 concluded that Realtime would not accept a
-- private topic outside the `channel:` prefix; that conclusion was wrong. The
-- same function and the same policies now join without complaint, so the C2
-- failure was transient — most likely Realtime holding an authorization or
-- policy result from before the migration landed. It was retried once, minutes
-- later, and that single retry was treated as conclusive. It was not.
--
-- Consequences for C3: a private `dm:<uuid>` topic is available, table-reading
-- authorization works inside a realtime policy, and DM typing indicators stay
-- in scope. Consequence for C2: the organization topic could be private, but
-- it is safe as it stands — Postgres Changes delivery is RLS-filtered per
-- subscriber — so tightening it is a separate decision, not C3 work.
--
-- STILL UNTESTED, and named rather than assumed: whether an ALREADY JOINED
-- private topic is cut off promptly when authorization is revoked mid-session
-- (a member removed from a conversation, suspended, or banned). If Realtime
-- caches the authorization result, a revoked member could keep receiving on a
-- live socket. This must be proved empirically while implementing DMs, not
-- assumed from the join-time behaviour above.
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

drop function if exists public.can_join_probe_topic(text);
drop function if exists public.can_join_probe_topic_b(text);
drop function if exists public.can_join_org_topic(text, text);
