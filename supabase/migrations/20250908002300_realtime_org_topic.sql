-- ===========================================================================
-- LFG HQ · Phase 2 · C2 · An organization-wide realtime topic
--
-- The sidebar has to learn about messages in channels nobody is looking at,
-- and the bell has to learn about notifications that belong to no channel at
-- all. Neither fits the per-channel topic C1 opened, and subscribing to ten
-- channel topics to watch for unread badges would be ten sockets doing one
-- job.
--
-- So: one additional private topic, `org:<uuid>`, carrying Postgres Changes
-- only. Row delivery is still filtered by RLS per subscriber — a member is
-- woken by a message they could have read and by a notification addressed to
-- them, and by nothing else.
--
-- `can_join_channel_topic` is left exactly as it was; a sibling handles the
-- new shape and the policies accept either.
--
-- ROLLBACK. Restore the two policies verbatim from
-- supabase/migrations/20250905001500_realtime_authorization.sql and drop
-- can_join_org_topic.
--
-- Additive only.
-- ===========================================================================

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
  -- Topics are `org:<uuid>`. Anything else is not ours to authorize.
  if p_topic is null or split_part(p_topic, ':', 1) <> 'org' then
    return false;
  end if;

  -- A malformed id is a refusal, never an exception: raising here would let a
  -- caller distinguish "bad format" from "no access" by the error they get.
  begin
    v_org := split_part(p_topic, ':', 2)::uuid;
  exception when others then
    return false;
  end;

  return public.has_org_permission(v_org, p_permission);
end;
$fn$;

comment on function public.can_join_org_topic is
  'Maps an org:<uuid> realtime topic onto the organization it belongs to. Returns false for anything unparseable rather than raising.';

revoke execute on function public.can_join_org_topic(text, text) from public, anon;
grant execute on function public.can_join_org_topic(text, text) to authenticated;

-- --- Realtime policies -----------------------------------------------------

drop policy if exists "Members can receive channel realtime events" on realtime.messages;
create policy "Members can receive channel realtime events"
  on realtime.messages for select to authenticated
  using (
    public.can_join_channel_topic((select realtime.topic()), 'channels.view')
    or public.can_join_org_topic((select realtime.topic()), 'channels.view')
  );

-- Emitting stays channel-only. Nobody broadcasts on the organization topic —
-- it carries database changes and nothing a client can write — so widening
-- the insert policy would grant a capability with no use.
drop policy if exists "Members can emit channel realtime events" on realtime.messages;
create policy "Members can emit channel realtime events"
  on realtime.messages for insert to authenticated
  with check (public.can_join_channel_topic((select realtime.topic()), 'messages.send'));
