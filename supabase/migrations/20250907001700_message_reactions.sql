-- ===========================================================================
-- LFG HQ · Phase 2 · C2 · Reactions
--
-- One row per (message, person, emoji). The composite primary key IS the
-- uniqueness rule — reacting twice with the same emoji is not an error to
-- detect, it is a row that cannot exist.
--
-- No new permission. Reacting is speaking in the channel, so it is gated on
-- `messages.send`: if a channel-local DENY on messages.send did not also
-- silence reactions, the deny would be trivially circumventable as a
-- signalling channel.
--
-- Visibility is inherited the same way C1 inherits it —
--
--     message_id in (select id from public.messages)
--
-- which defers to the messages policy, which defers to the channels policy,
-- which calls can_in_channel. Three layers, one implementation, nothing to
-- drift.
--
-- Additive only.
-- ===========================================================================

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,

  -- Denormalized from the message so the realtime subscription can filter on
  -- it. Stamped by the trigger below and never accepted from a client.
  channel_id uuid not null references public.channels (id) on delete cascade,

  created_at timestamptz not null default now(),

  primary key (message_id, user_id, emoji),

  -- Postgres regex has no \p{Emoji}, so this is the honest limit: short, and
  -- containing no letters, digits or whitespace. It stops the column quietly
  -- becoming a free-text label field.
  constraint message_reactions_emoji_shape check (
    char_length(emoji) between 1 and 8 and emoji !~ '[[:alnum:][:space:]]'
  )
);

comment on table public.message_reactions is
  'Emoji reactions. Visibility inherits from the messages policy; adding one requires messages.send in that channel.';

-- --- channel_id belongs to the server ---------------------------------------

create or replace function public.tg_reaction_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  select channel_id into new.channel_id
  from public.messages where id = new.message_id;

  if new.channel_id is null then
    raise exception 'Message not found' using errcode = 'no_data_found';
  end if;

  return new;
end;
$fn$;

create trigger message_reactions_stamp_channel
  before insert on public.message_reactions
  for each row execute function public.tg_reaction_channel();

-- --- RLS -------------------------------------------------------------------

alter table public.message_reactions enable row level security;

create policy "Members can read reactions on messages they can see"
  on public.message_reactions for select to authenticated
  using (message_id in (select id from public.messages));

-- `user_id` is checked against the session rather than trusted from the
-- request: without this, anyone could react as somebody else.
create policy "Members can react where they may send"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.messages m
      where m.id = message_id
        and m.deleted_at is null
        and public.can_in_channel(m.channel_id, 'messages.send')
    )
  );

-- Yours to take back, and only yours. Clearing somebody else's reaction is a
-- moderation power that C2 deliberately does not grant; adding it later is a
-- policy edit, not a redesign.
create policy "Members can remove their own reaction"
  on public.message_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- No UPDATE policy at all: a reaction is added or removed, never edited.

revoke all on public.message_reactions from anon;
grant select, insert, delete on public.message_reactions to authenticated;

-- --- Realtime --------------------------------------------------------------
-- A DELETE payload carries only the replica identity. The default is the
-- primary key, which would omit channel_id — and the subscription filters on
-- exactly that, so removals would never reach the client. FULL is a few extra
-- bytes of WAL on a tiny table and makes the filter work in both directions.

alter table public.message_reactions replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
