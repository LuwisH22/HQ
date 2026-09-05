-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · What a conversation needs besides its messages
--
-- Read state, search and a realtime topic. Each is the channel version of
-- itself with the word "channel" replaced, and each is built the same way for
-- the same reason — so there is one idea per feature, not two.
--
--   READ STATE is a second table rather than a nullable column on
--   channel_reads. The two have different foreign keys and different
--   authorization, and a single table with one of two ids populated would put
--   an XOR in the place where the isolation guarantee lives. channel_reads is
--   not touched by this file at all.
--
--   SEARCH is the same function. It is SECURITY INVOKER over `messages`, so
--   the moment a direct message became a message it became searchable to
--   exactly the people who can read it and nobody else. What is added is the
--   ability to *say* which place to search, and a column in the result saying
--   which place a hit came from. WITH NEITHER GIVEN THE BEHAVIOUR IS
--   UNCHANGED: channel messages only, exactly as before this file.
--
--   THE REALTIME TOPIC is `dm:<conversation_id>`, private, authorized by
--   can_in_conversation. The C3 Step 1 probe established that a private topic
--   outside the `channel:` prefix joins and that table-reading authorization
--   works inside a realtime policy; this is that result put into production.
--
-- Additive. Two policies on realtime.messages are replaced, each gaining one
-- OR; their previous bodies are in
-- supabase/migrations/20250909002700_dm_topic_probe_revert.sql.
-- ===========================================================================

-- --- Read state -------------------------------------------------------------

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  last_read_at    timestamptz not null default now(),

  primary key (conversation_id, user_id)
);

comment on table public.conversation_reads is
  'How far each member has read in each conversation. Private to its owner, and separate from channel_reads on purpose.';

-- The same trigger function channel_reads uses. It touches one column and
-- knows nothing about channels, so there is no second implementation of
-- "never move a read marker backwards".
create trigger conversation_reads_stamp
  before insert or update on public.conversation_reads
  for each row execute function public.tg_channel_read_stamp();

alter table public.conversation_reads enable row level security;

create policy "Your own read state, and only yours"
  on public.conversation_reads for select to authenticated
  using (user_id = (select auth.uid()));

create policy "You may record a read in a conversation you are in"
  on public.conversation_reads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_in_conversation(conversation_id)
  );

create policy "You may move your own marker"
  on public.conversation_reads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.can_in_conversation(conversation_id)
  );

-- No DELETE policy, matching channel_reads.

revoke all on public.conversation_reads from anon;
grant select, insert, update on public.conversation_reads to authenticated;

-- --- Counting ---------------------------------------------------------------
--
-- SECURITY INVOKER, like unread_counts. The conversations and messages
-- policies do the filtering, so a conversation the caller is not in
-- contributes no row and no number — there is no WHERE clause here that could
-- be forgotten.

create or replace function public.conversation_unread_counts()
returns table (
  conversation_id uuid,
  unread          integer,
  last_read_at    timestamptz,
  last_message_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select
    c.id,
    count(m.id) filter (
      where m.deleted_at is null
        and m.author_id is distinct from (select auth.uid())
        and (r.last_read_at is null or m.created_at > r.last_read_at)
    )::integer,
    r.last_read_at,
    max(m.created_at) filter (where m.deleted_at is null)
  from public.conversations c
  left join public.conversation_reads r
    on r.conversation_id = c.id
   and r.user_id = (select auth.uid())
  left join public.messages m
    on m.conversation_id = c.id
  group by c.id, r.last_read_at;
$fn$;

comment on function public.conversation_unread_counts is
  'Unread count and last activity per conversation the caller is in. SECURITY INVOKER: a conversation you are not in yields no row at all.';

revoke execute on function public.conversation_unread_counts() from public, anon;
grant execute on function public.conversation_unread_counts() to authenticated;

-- --- Search -----------------------------------------------------------------
--
-- ROLLBACK: restore the function verbatim from
-- supabase/migrations/20250910002810_search_thread_context.sql.
--
-- A return type cannot be changed by CREATE OR REPLACE, so it is dropped and
-- recreated. The body gains one returned column and one scope clause;
-- authorization, ranking and ordering are untouched.

drop function if exists public.search_messages(text, uuid, integer, timestamptz);

create function public.search_messages(
  p_query           text,
  p_channel_id      uuid default null,
  p_limit           integer default 30,
  p_before          timestamptz default null,
  p_conversation_id uuid default null
)
returns table (
  id                uuid,
  channel_id        uuid,
  conversation_id   uuid,
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
    m.conversation_id,
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
    and (
      case
        -- One place, named. Either way the policy decides what "can see" means.
        when p_channel_id is not null then m.channel_id = p_channel_id
        when p_conversation_id is not null then m.conversation_id = p_conversation_id
        -- Neither named: every channel the caller can see, and no direct
        -- messages. Unchanged from before conversations existed — a search
        -- box that started returning private correspondence because the
        -- schema grew a column would be a surprise, and surprises about
        -- where private things appear are the expensive kind.
        else m.channel_id is not null
      end
    )
    and (p_before is null or m.created_at < p_before)
    and m.search_vector @@ websearch_to_tsquery(
      'pg_catalog.simple'::regconfig, coalesce(p_query, '')
    )
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
$fn$;

comment on function public.search_messages is
  'Full text search over messages. SECURITY INVOKER, so results are already scoped by the messages policy. A channel or a conversation may be named; naming neither searches channels only, which is what it did before conversations existed.';

revoke execute on function public.search_messages(text, uuid, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.search_messages(text, uuid, integer, timestamptz, uuid)
  to authenticated;

-- --- The realtime topic -----------------------------------------------------
--
-- Typing indicators in a conversation are the same ephemeral broadcasts they
-- are in a channel: nothing stored, and nothing delivered to somebody who is
-- not in the conversation.
--
-- One function for both directions. In a channel, reading and emitting are
-- separate permissions because someone may be allowed to watch and not to
-- speak. In a conversation there is no such distinction to make — you are in
-- it, and being in it is the whole of it.

create or replace function public.can_join_conversation_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_conversation_id uuid;
begin
  -- Topics are `dm:<uuid>`. Anything else is not ours to authorize.
  if p_topic is null or split_part(p_topic, ':', 1) <> 'dm' then
    return false;
  end if;

  -- A malformed id is a refusal, never an exception: raising here would let a
  -- caller distinguish "bad format" from "no access" by the error they get.
  begin
    v_conversation_id := split_part(p_topic, ':', 2)::uuid;
  exception when others then
    return false;
  end;

  return public.can_in_conversation(v_conversation_id);
end;
$fn$;

comment on function public.can_join_conversation_topic is
  'Maps a realtime topic name onto the conversation it belongs to and defers to can_in_conversation. Returns false for anything unparseable rather than raising.';

revoke execute on function public.can_join_conversation_topic(text) from public, anon;
grant execute on function public.can_join_conversation_topic(text) to authenticated;

drop policy if exists "Members can receive channel realtime events" on realtime.messages;
create policy "Members can receive channel realtime events"
  on realtime.messages for select to authenticated
  using (
    public.can_join_channel_topic((select realtime.topic()), 'channels.view')
    or public.can_join_conversation_topic((select realtime.topic()))
  );

drop policy if exists "Members can emit channel realtime events" on realtime.messages;
create policy "Members can emit channel realtime events"
  on realtime.messages for insert to authenticated
  with check (
    public.can_join_channel_topic((select realtime.topic()), 'messages.send')
    or public.can_join_conversation_topic((select realtime.topic()))
  );
