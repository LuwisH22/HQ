-- ===========================================================================
-- LFG HQ · Phase 2 · C1 · Messages
--
-- Text messages in channels, and nothing else: no reactions, no threads, no
-- read state, no direct messages. Typing indicators are deliberately absent
-- from this file — they are ephemeral Realtime events and never touch Postgres.
--
-- VISIBILITY IS INHERITED, NOT RE-DERIVED. The SELECT policy is
--
--     channel_id in (select id from public.channels)
--
-- which defers to the channels policy, which calls `can_in_channel`. Two
-- consequences, both wanted:
--
--   * every B3 rule applies unchanged — private channels, deny overrides,
--     suspended and banned members — with no second implementation to drift;
--   * the resolver runs once per *channel* rather than once per *message*, so
--     a page of two hundred messages costs one evaluation, not two hundred.
--
-- Writing is different: sending needs `messages.send`, not `channels.view`, so
-- the INSERT policy calls the resolver directly. That is once per message
-- sent, which is the right price.
--
-- Additive only.
-- ===========================================================================

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.channels (id) on delete cascade,
  -- Nullable so a channel's history survives someone being removed: their
  -- messages remain and simply lose an author.
  author_id    uuid references public.profiles (id) on delete set null,
  body         text not null,

  pinned_at    timestamptz,
  pinned_by    uuid references public.profiles (id) on delete set null,
  edited_at    timestamptz,

  -- Soft delete. A hard delete would break replies that point at this row and
  -- would erase the evidence a moderation decision was made.
  deleted_at   timestamptz,
  deleted_by   uuid references public.profiles (id) on delete set null,

  created_at   timestamptz not null default now(),

  -- A deleted message has its body cleared, so the length rule only applies
  -- while it is live.
  constraint messages_body_length check (
    deleted_at is not null or char_length(body) between 1 and 4000
  )
);

comment on table public.messages is
  'Channel messages. Visibility inherits from the channels policy, which is the single source of truth for channel access.';

-- Keyset pagination reads newest-first within a channel; OFFSET would degrade
-- as history grows and can skip rows when new messages arrive mid-scroll.
create index messages_channel_created_idx
  on public.messages (channel_id, created_at desc, id desc);

create index messages_author_idx on public.messages (author_id);

create index messages_pinned_idx
  on public.messages (channel_id, pinned_at desc)
  where pinned_at is not null;

-- --- Only the author's own words are theirs to change -----------------------
-- The UPDATE policy below already restricts *who* may edit. This restricts
-- *what*: a client edit may touch the body and nothing else, so an author
-- cannot pin their own message, move it to another channel, or forge a
-- deletion. The routines set the transaction-local flag to bypass it, the same
-- way moderation does in B2.

create or replace function public.tg_protect_message_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is null
     or coalesce(current_setting('lfghq.messaging', true), '') = 'on' then
    return new;
  end if;

  if new.channel_id is distinct from old.channel_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at
     or new.pinned_at is distinct from old.pinned_at
     or new.pinned_by is distinct from old.pinned_by
     or new.deleted_at is distinct from old.deleted_at
     or new.deleted_by is distinct from old.deleted_by then
    raise exception
      'Only the message body may be edited. Use delete_message() or pin_message().'
      using errcode = 'insufficient_privilege';
  end if;

  -- Stamp the edit here so a client cannot claim a message was never edited.
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;

  return new;
end;
$fn$;

create trigger messages_protect_columns
  before update on public.messages
  for each row execute function public.tg_protect_message_columns();

-- --- RLS -------------------------------------------------------------------

alter table public.messages enable row level security;

-- Inherits channel visibility wholesale. Nothing here re-implements B3.
create policy "Members can read messages in channels they can see"
  on public.messages for select to authenticated
  using (channel_id in (select id from public.channels));

-- `author_id` is checked against the session rather than trusted from the
-- request: without this, anyone could post under someone else's name.
create policy "Members can post where they may send"
  on public.messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_in_channel(channel_id, 'messages.send')
    and deleted_at is null
    and pinned_at is null
    and edited_at is null
  );

-- Editing is an author's right, not a capability: `messages.moderate` confers
-- the power to remove someone's message, never to rewrite their words.
create policy "Authors can edit their own message"
  on public.messages for update to authenticated
  using (
    author_id = (select auth.uid())
    and deleted_at is null
    and public.can_in_channel(channel_id, 'messages.send')
  )
  with check (author_id = (select auth.uid()));

-- No DELETE policy at all: removal is a soft delete performed by
-- delete_message(), which records who did it.

revoke all on public.messages from anon;
grant select, insert, update on public.messages to authenticated;

-- --- Realtime --------------------------------------------------------------
-- Postgres Changes evaluates RLS per subscriber, so a client only receives
-- events for messages it could have read anyway. Guarded because the
-- publication is managed by the platform.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
