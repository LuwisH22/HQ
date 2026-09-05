-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · THROWAWAY PROBE part two — what actually failed
--
-- Part one showed a private `dm:<uuid>` topic joining, refusing a stranger,
-- and round-tripping a broadcast. But its authorization function only
-- compared a uuid to auth.uid(). The real one, can_in_conversation, will read
-- tables — exactly what C2's can_join_org_topic did through
-- has_org_permission when Realtime refused the join.
--
-- So part one may be a false green, and building DMs on it would be building
-- on an untested premise. This isolates the variable with a 2x2:
--
--   dmb:<org uuid>  -> has_org_permission(...)   a NEW prefix, table reads
--   org:<org uuid>  -> has_org_permission(...)   C2's exact shape, replayed
--
--   both join       -> C2's failure was environmental and is gone
--   dmb joins only  -> `org` is special to Realtime; any other prefix is fine
--   neither joins   -> nested table-reading authorization is the constraint,
--                      and can_in_conversation cannot be used this way
--
-- Reverted by 20250909002700 along with part one. Builds no feature.
-- ===========================================================================

-- A new prefix, authorized the way the real one will be: by reading tables.
create or replace function public.can_join_probe_topic_b(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
begin
  if p_topic is null or split_part(p_topic, ':', 1) <> 'dmb' then
    return false;
  end if;

  begin
    v_org := split_part(p_topic, ':', 2)::uuid;
  exception when others then
    return false;
  end;

  return public.has_org_permission(v_org, 'channels.view');
end;
$fn$;

-- C2's function, restored verbatim under its original name, to confirm the
-- old behaviour still reproduces rather than trusting a memory of it.
create or replace function public.can_join_org_topic(p_topic text, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
begin
  if p_topic is null or split_part(p_topic, ':', 1) <> 'org' then
    return false;
  end if;

  begin
    v_org := split_part(p_topic, ':', 2)::uuid;
  exception when others then
    return false;
  end;

  return public.has_org_permission(v_org, p_permission);
end;
$fn$;

revoke execute on function public.can_join_probe_topic_b(text) from public, anon;
revoke execute on function public.can_join_org_topic(text, text) from public, anon;
grant execute on function public.can_join_probe_topic_b(text) to authenticated;
grant execute on function public.can_join_org_topic(text, text) to authenticated;

drop policy if exists "Members can receive channel realtime events" on realtime.messages;
create policy "Members can receive channel realtime events"
  on realtime.messages for select to authenticated
  using (
    public.can_join_channel_topic((select realtime.topic()), 'channels.view')
    or public.can_join_probe_topic((select realtime.topic()))
    or public.can_join_probe_topic_b((select realtime.topic()))
    or public.can_join_org_topic((select realtime.topic()), 'channels.view')
  );

drop policy if exists "Members can emit channel realtime events" on realtime.messages;
create policy "Members can emit channel realtime events"
  on realtime.messages for insert to authenticated
  with check (
    public.can_join_channel_topic((select realtime.topic()), 'messages.send')
    or public.can_join_probe_topic((select realtime.topic()))
    or public.can_join_probe_topic_b((select realtime.topic()))
    or public.can_join_org_topic((select realtime.topic()), 'channels.view')
  );
