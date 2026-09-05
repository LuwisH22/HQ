-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · Search results say when a hit is a reply
--
-- Replies became searchable the moment they became messages — the function is
-- SECURITY INVOKER over `messages`, so nothing had to be taught about them.
-- But a reply in a result list is indistinguishable from a message in the
-- channel, which makes the result misleading: opening it lands somewhere the
-- text is not.
--
-- One column added to the return. Nothing about the query, the ranking, the
-- authorization or the scoping changes.
--
-- A return type cannot be changed by CREATE OR REPLACE, so the function is
-- dropped and recreated. ROLLBACK: restore it verbatim from
-- supabase/migrations/20250908002000_message_search.sql.
-- ===========================================================================

drop function if exists public.search_messages(text, uuid, integer, timestamptz);

create function public.search_messages(
  p_query      text,
  p_channel_id uuid default null,
  p_limit      integer default 30,
  p_before     timestamptz default null
)
returns table (
  id                uuid,
  channel_id        uuid,
  author_id         uuid,
  body              text,
  created_at        timestamptz,
  rank              real,
  parent_message_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select
    m.id,
    m.channel_id,
    m.author_id,
    m.body,
    m.created_at,
    ts_rank(
      m.search_vector,
      websearch_to_tsquery('pg_catalog.simple'::regconfig, coalesce(p_query, ''))
    ),
    m.parent_message_id
  from public.messages m
  where m.deleted_at is null
    -- NULL searches every channel the caller can see; a value narrows it to
    -- one. Either way the policy decides what "can see" means.
    and (p_channel_id is null or m.channel_id = p_channel_id)
    and (p_before is null or m.created_at < p_before)
    and m.search_vector @@ websearch_to_tsquery(
      'pg_catalog.simple'::regconfig, coalesce(p_query, '')
    )
  -- Recency over relevance: in a chat you are looking for the thing somebody
  -- said yesterday, not the most lexically dense match of all time. `rank` is
  -- returned so that can be reconsidered without another migration.
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
$fn$;

comment on function public.search_messages is
  'Full text search over messages, replies included. SECURITY INVOKER, so results are already scoped by the messages policy. websearch_to_tsquery is used because it never raises on malformed input; an empty query matches nothing.';

revoke execute on function public.search_messages(text, uuid, integer, timestamptz)
  from public, anon;
grant execute on function public.search_messages(text, uuid, integer, timestamptz)
  to authenticated;
