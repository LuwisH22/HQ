-- ===========================================================================
-- LFG HQ · Phase 2 · C2 · Joining the organization topic
--
-- The SELECT policy added in 20250908002300 accepts `org:<uuid>`, and
-- can_join_org_topic returns true for it when called directly — verified in
-- verify-live. Realtime still refused the join with "you do not have
-- permissions to read from this Channel topic".
--
-- The remaining structural difference was the write policy: for a
-- `channel:<uuid>` topic both policies passed, and for `org:<uuid>` only the
-- read one did. Realtime evaluates both when a client joins a private topic,
-- so a topic that cannot be written to cannot be joined either.
--
-- Widening the write policy is therefore what makes the topic usable. It is
-- narrow in practice: emitting still requires membership of that organization
-- resolved through has_org_permission, no code in the app broadcasts on this
-- topic, and the only thing it carries is Postgres Changes — whose row
-- delivery is filtered by RLS per subscriber regardless of who may push.
--
-- ROLLBACK. Restore the insert policy from 20250908002300 (channel topics
-- only); the organization topic then stops being joinable and the unread
-- badge falls back to refetching on navigation.
--
-- Additive only.
-- ===========================================================================

drop policy if exists "Members can emit channel realtime events" on realtime.messages;
create policy "Members can emit channel realtime events"
  on realtime.messages for insert to authenticated
  with check (
    public.can_join_channel_topic((select realtime.topic()), 'messages.send')
    or public.can_join_org_topic((select realtime.topic()), 'channels.view')
  );
