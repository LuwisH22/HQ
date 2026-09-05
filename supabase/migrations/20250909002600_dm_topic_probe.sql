-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · THROWAWAY PROBE — private realtime topic mechanism
--
-- This migration exists to answer one question and is reverted immediately
-- afterwards by 20250909002700. It builds no feature and is not part of C3.
--
-- THE QUESTION. C2 tried to make `org:<uuid>` a private realtime topic and
-- Realtime refused the join — "you do not have permissions to read from this
-- Channel topic" — while can_join_org_topic returned true for that exact
-- string when called directly, and again with the write policy widened to
-- match. The cause was never isolated. C3 wants a private `dm:<uuid>` topic,
-- so before anything is built on that assumption it has to be tested.
--
-- WHAT IS BEING TESTED is the *mechanism*, not the DM feature: can Realtime
-- join a private topic whose name does not begin with `channel:` at all? The
-- rule below is therefore the narrowest one that makes a second prefix
-- joinable — your own user id — and deliberately has nothing to do with
-- conversations, which do not exist yet.
--
-- ROLLBACK is 20250909002700, which restores both policies verbatim from
-- supabase/migrations/20250908002500_realtime_org_topic_revert.sql and drops
-- the function added here. Nothing else in the schema is touched.
-- ===========================================================================

create or replace function public.can_join_probe_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if p_topic is null or split_part(p_topic, ':', 1) <> 'dm' then
    return false;
  end if;

  -- A malformed id is a refusal, never an exception.
  begin
    v_id := split_part(p_topic, ':', 2)::uuid;
  exception when others then
    return false;
  end;

  -- The narrowest possible rule: your own topic, and nobody else's. Enough to
  -- learn whether a second prefix can be joined at all.
  return v_id = (select auth.uid());
end;
$fn$;

revoke execute on function public.can_join_probe_topic(text) from public, anon;
grant execute on function public.can_join_probe_topic(text) to authenticated;

drop policy if exists "Members can receive channel realtime events" on realtime.messages;
create policy "Members can receive channel realtime events"
  on realtime.messages for select to authenticated
  using (
    public.can_join_channel_topic((select realtime.topic()), 'channels.view')
    or public.can_join_probe_topic((select realtime.topic()))
  );

drop policy if exists "Members can emit channel realtime events" on realtime.messages;
create policy "Members can emit channel realtime events"
  on realtime.messages for insert to authenticated
  with check (
    public.can_join_channel_topic((select realtime.topic()), 'messages.send')
    or public.can_join_probe_topic((select realtime.topic()))
  );
