-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · Threads
--
-- A reply is a message with a parent. No `threads` table, no
-- `thread_messages` table, no second copy of anything: visibility,
-- reactions, search, pins, mentions, moderation and realtime all keep
-- working on replies because replies are messages going through the same
-- policies.
--
-- The foreign key is ON DELETE RESTRICT, deliberately. CASCADE would mean a
-- hard delete of a root silently destroying every reply under it. C1's soft
-- delete is authoritative — a deleted root keeps its row precisely so replies
-- survive — and RESTRICT makes the destructive path fail loudly rather than
-- take the thread with it.
--
-- One level only. A reply cannot itself be replied to, so a thread is a root
-- and a flat list, never a tree that has to be walked.
--
-- Additive. One existing object is replaced: tg_protect_message_columns,
-- whose original body is reproduced in full below for rollback.
-- ===========================================================================

alter table public.messages
  -- RESTRICT, not CASCADE. See above.
  add column parent_message_id uuid references public.messages (id) on delete restrict,
  -- Denormalised so rendering fifty messages costs nothing. Maintained by the
  -- trigger below and refused from a client by the protection trigger.
  add column reply_count integer not null default 0,
  add column last_reply_at timestamptz;

comment on column public.messages.parent_message_id is
  'NULL for a message in a channel; set for a reply. One level only: a reply may not have a parent.';

-- The thread view reads one root''s replies in order. Partial, because the
-- overwhelming majority of messages are not replies.
create index messages_thread_idx
  on public.messages (parent_message_id, created_at)
  where parent_message_id is not null;

-- The channel timeline reads only what is not a reply.
create index messages_channel_roots_idx
  on public.messages (channel_id, created_at desc, id desc)
  where parent_message_id is null;

-- --- The shape of a thread is the database''s to enforce --------------------

create or replace function public.tg_message_thread_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_parent public.messages;
begin
  -- A counter is never seeded by whoever is inserting.
  new.reply_count := 0;
  new.last_reply_at := null;

  if new.parent_message_id is null then
    return new;
  end if;

  select * into v_parent from public.messages where id = new.parent_message_id;

  if v_parent is null then
    raise exception 'That message no longer exists' using errcode = 'no_data_found';
  end if;

  -- One level. Replying to a reply would make a tree out of a list.
  if v_parent.parent_message_id is not null then
    raise exception 'A reply cannot itself be replied to'
      using errcode = 'check_violation';
  end if;

  -- A reply belongs to the same channel as its root, or channel authorization
  -- would be answering about one channel while the message sits in another.
  if v_parent.channel_id is distinct from new.channel_id then
    raise exception 'A reply must be in the same channel as the message it replies to'
      using errcode = 'check_violation';
  end if;

  -- The root survives deletion as a placeholder so existing replies keep
  -- their context, but a conversation whose opening is gone is not one to
  -- carry on adding to.
  if v_parent.deleted_at is not null then
    raise exception 'That message has been deleted' using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

create trigger messages_thread_guard
  before insert on public.messages
  for each row execute function public.tg_message_thread_guard();

-- --- Keeping the count honest ----------------------------------------------

create or replace function public.tg_message_thread_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_root uuid := coalesce(new.parent_message_id, old.parent_message_id);
  v_previous text := coalesce(current_setting('lfghq.messaging', true), '');
begin
  if v_root is null then
    return null;
  end if;

  -- The columns below are refused from a client, so the routine has to say
  -- it is the one writing them. Restored rather than switched off: the
  -- calling statement may still be inside its own guarded section.
  perform set_config('lfghq.messaging', 'on', true);

  update public.messages
  set reply_count = (
        select count(*)
        from public.messages r
        where r.parent_message_id = v_root and r.deleted_at is null
      ),
      last_reply_at = (
        select max(r.created_at)
        from public.messages r
        where r.parent_message_id = v_root and r.deleted_at is null
      )
  where id = v_root;

  perform set_config('lfghq.messaging', v_previous, true);
  return null;
end;
$fn$;

create trigger messages_thread_counted
  after insert on public.messages
  for each row
  when (new.parent_message_id is not null)
  execute function public.tg_message_thread_counter();

-- A soft-deleted reply stops counting. Recomputed rather than decremented, so
-- the number cannot drift away from the rows it describes.
create trigger messages_thread_recounted
  after update of deleted_at on public.messages
  for each row
  when (old.deleted_at is null and new.deleted_at is not null
        and new.parent_message_id is not null)
  execute function public.tg_message_thread_counter();

-- --- Three more columns a client may not write ------------------------------
--
-- ROLLBACK: the original body of this function is
--
--   begin
--     if (select auth.uid()) is null
--        or coalesce(current_setting('lfghq.messaging', true), '') = 'on' then
--       return new;
--     end if;
--
--     if new.channel_id is distinct from old.channel_id
--        or new.author_id is distinct from old.author_id
--        or new.created_at is distinct from old.created_at
--        or new.pinned_at is distinct from old.pinned_at
--        or new.pinned_by is distinct from old.pinned_by
--        or new.deleted_at is distinct from old.deleted_at
--        or new.deleted_by is distinct from old.deleted_by then
--       raise exception
--         'Only the message body may be edited. Use delete_message() or pin_message().'
--         using errcode = 'insufficient_privilege';
--     end if;
--
--     if new.body is distinct from old.body then
--       new.edited_at := now();
--     end if;
--
--     return new;
--   end;
--
-- from supabase/migrations/20250905001300_message_schema.sql.

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
     or new.deleted_by is distinct from old.deleted_by
     -- Re-parenting a message would move it into a thread it was never part
     -- of, and the two counters describe rows rather than opinions.
     or new.parent_message_id is distinct from old.parent_message_id
     or new.reply_count is distinct from old.reply_count
     or new.last_reply_at is distinct from old.last_reply_at then
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
