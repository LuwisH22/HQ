-- ===========================================================================
-- LFG HQ · Phase 2 · C2 · Message search
--
-- Postgres full text search and nothing else. No Elasticsearch, no Algolia,
-- no Meilisearch, no Redis: six people and a few hundred thousand messages a
-- year is a workload a GIN index does not notice.
--
-- The configuration is `simple`, not `english`. This organization writes
-- Indonesian and English in the same sentence, and English stemming would
-- mangle the Indonesian while buying nothing on the rest. `simple` matches
-- words as written, which is what someone looking for a name or a map call
-- actually wants.
--
-- Authorization is the messages policy, full stop. The function is SECURITY
-- INVOKER, so a private channel the caller cannot see cannot appear in a
-- result — by exactly the guarantee their message list already has. There is
-- no allow-list to maintain and no WHERE clause to forget.
--
-- Adding a stored generated column rewrites the table. Doing it now, while
-- the table holds one row, is the cheapest it will ever be.
--
-- Additive only.
-- ===========================================================================

-- The regconfig is written explicitly, and schema-qualified: to_tsvector(text)
-- reads default_text_search_config and is only STABLE, which a generated
-- column will not accept. Naming the configuration makes it IMMUTABLE.
alter table public.messages
  add column search_vector tsvector
  generated always as (
    to_tsvector('pg_catalog.simple'::regconfig, coalesce(body, ''))
  ) stored;

comment on column public.messages.search_vector is
  'Full text index of the body, simple configuration. Generated: never written by a client.';

-- Partial, because a deleted message must never match and its body is empty
-- anyway. Keeps the index to the rows that can be found.
create index messages_search_idx
  on public.messages using gin (search_vector)
  where deleted_at is null;

create or replace function public.search_messages(
  p_query      text,
  p_channel_id uuid default null,
  p_limit      integer default 30,
  p_before     timestamptz default null
)
returns table (
  id         uuid,
  channel_id uuid,
  author_id  uuid,
  body       text,
  created_at timestamptz,
  rank       real
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
    )
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
  'Full text search over messages. SECURITY INVOKER, so results are already scoped by the messages policy. websearch_to_tsquery is used because it never raises on malformed input; an empty query matches nothing.';

revoke execute on function public.search_messages(text, uuid, integer, timestamptz)
  from public, anon;
grant execute on function public.search_messages(text, uuid, integer, timestamptz)
  to authenticated;
