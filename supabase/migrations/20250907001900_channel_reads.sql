-- ===========================================================================
-- LFG HQ · Phase 2 · C2 · Read state
--
-- One row per member per channel, holding a single timestamp. Deliberately
-- not a `last_read_message_id`: counting is then a timestamp comparison
-- instead of a join, and "jump to the first unread" is still derivable later
-- as the earliest message after the marker. One column, no second source of
-- truth about the same fact.
--
-- There is no routine for marking a channel read. A plain upsert is enough,
-- because the policy below already says the only row you may write is your
-- own and only in a channel you can already see — which is also what stops
-- read state being used to probe whether a private channel exists.
--
-- Counting is SECURITY INVOKER on purpose. It runs as the caller, so the
-- channels and messages policies apply unchanged and a channel you cannot see
-- contributes no row and no number. That is the whole isolation story: there
-- is no filtering here to get wrong.
--
-- Additive only.
-- ===========================================================================

create table public.channel_reads (
  channel_id   uuid not null references public.channels (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),

  primary key (channel_id, user_id)
);

comment on table public.channel_reads is
  'How far each member has read in each channel. Private to its owner: nobody needs to know when somebody else last looked.';

-- --- The marker belongs to the server, and only moves forward --------------

create or replace function public.tg_channel_read_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    new.last_read_at := now();
  else
    -- Never backwards. Two devices are normal; a stale one catching up must
    -- not undo a read the other already recorded.
    new.last_read_at := greatest(old.last_read_at, now());
  end if;

  return new;
end;
$fn$;

create trigger channel_reads_stamp
  before insert or update on public.channel_reads
  for each row execute function public.tg_channel_read_stamp();

-- --- RLS -------------------------------------------------------------------

alter table public.channel_reads enable row level security;

create policy "Your own read state, and only yours"
  on public.channel_reads for select to authenticated
  using (user_id = (select auth.uid()));

create policy "You may record a read in a channel you can see"
  on public.channel_reads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and channel_id in (select id from public.channels)
  );

create policy "You may move your own marker"
  on public.channel_reads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and channel_id in (select id from public.channels)
  );

-- No DELETE policy: forgetting where you had read to is not an operation
-- anyone has asked for, and the row is one timestamp.

revoke all on public.channel_reads from anon;
grant select, insert, update on public.channel_reads to authenticated;

-- --- Counting --------------------------------------------------------------

create or replace function public.unread_counts()
returns table (channel_id uuid, unread integer, last_read_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select
    c.id,
    count(m.id)::integer,
    r.last_read_at
  from public.channels c
  left join public.channel_reads r
    on r.channel_id = c.id
   and r.user_id = (select auth.uid())
  left join public.messages m
    on m.channel_id = c.id
   -- Your own words are not news, and a deleted message is not unread.
   and m.deleted_at is null
   and m.author_id is distinct from (select auth.uid())
   and (r.last_read_at is null or m.created_at > r.last_read_at)
  where c.archived_at is null
  group by c.id, r.last_read_at;
$fn$;

comment on function public.unread_counts is
  'Unread message count per visible channel. SECURITY INVOKER: the channels and messages policies do the filtering, so an inaccessible channel yields no row at all.';

revoke execute on function public.unread_counts() from public, anon;
grant execute on function public.unread_counts() to authenticated;
