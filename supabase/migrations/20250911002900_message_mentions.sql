-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · Durable mentions
--
-- C2 parsed `@handle` out of a message body and wrote a notification, then
-- forgot what it had found. That was enough to notify somebody and not enough
-- to render the mention afterwards, because "which spans are mentions, and
-- who is each one" had to be guessed again by re-parsing — and a display name
-- that changes turns yesterday's mention into ordinary text.
--
-- So the relationship becomes a row. The body stays plain text: readable,
-- searchable, and needing no editor. `handle` records the name as written, so
-- rendering can highlight exactly that span even after a rename, while
-- `user_id` keeps pointing at the right person.
--
-- STILL BACKEND-AUTHORITATIVE. The table has no INSERT policy at all. Rows are
-- written only by the trigger below, which resolves a handle to a member of
-- the message's own organization and then asks can_in_channel_for whether
-- that member could read the message. A client cannot name its own
-- recipients, and cannot mention its way into learning that somebody exists
-- in a channel it has no access to.
--
-- Two existing functions are replaced. Their original bodies are reproduced in
-- full below for rollback.
--
-- Additive. No new permission, no change to can_in_channel or
-- can_in_channel_for, no change to role semantics.
-- ===========================================================================

create table public.message_mentions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- As written. A rename must not silently un-highlight what was said.
  handle     text not null,

  -- Mentioning somebody three times in one message is still one mention.
  primary key (message_id, user_id),

  constraint message_mentions_handle_length check (char_length(handle) between 2 and 40)
);

comment on table public.message_mentions is
  'Who a message mentions. Written only by tg_message_mentions, which resolves handles server-side and refuses anyone who could not read the message.';

-- The obvious second access path: everything that mentions one person.
create index message_mentions_user_idx on public.message_mentions (user_id);

alter table public.message_mentions enable row level security;

-- Inherited wholesale from the messages policy, the same way reactions are:
-- a mention on a message you cannot read is absent, not filtered.
create policy "Members can read mentions on messages they can see"
  on public.message_mentions for select to authenticated
  using (message_id in (select id from public.messages));

-- No INSERT, UPDATE or DELETE policy, on purpose.

revoke all on public.message_mentions from anon;
grant select on public.message_mentions to authenticated;

-- --- Recording them ---------------------------------------------------------
--
-- ROLLBACK: the original body of tg_message_mentions is in
-- supabase/migrations/20250908002200_mention_notifications.sql, and the
-- original trigger was
--
--   create trigger messages_mentions
--     after insert on public.messages
--     for each row execute function public.tg_message_mentions();
--
-- Two behaviours change. Mentions are now recorded as rows as well as
-- notified, and an edit re-derives them — C2 deliberately skipped edits for
-- want of a dedupe, and the primary key above is that dedupe. Somebody named
-- by an edit is notified once, when they are first named.

create or replace function public.tg_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_channel public.channels;
  v_actor   uuid := new.author_id;
  v_name    text;
  v_handle  text;
  v_target  uuid;
  v_seen    uuid[] := '{}';
  v_fresh   boolean;
begin
  if new.deleted_at is not null or coalesce(new.body, '') = '' then
    return null;
  end if;

  select * into v_channel from public.channels where id = new.channel_id;
  if v_channel is null then
    return null;
  end if;

  select coalesce(p.display_name, p.full_name, p.email) into v_name
  from public.profiles p where p.id = v_actor;

  for v_handle in
    select distinct lower(m[1])
    from regexp_matches(new.body, '@([A-Za-z0-9._-]{2,40})', 'g') as m
  loop
    -- A handle is a display name or the local part of the sign-in address,
    -- and only within this message's own organization — which is what makes a
    -- cross-organization mention impossible rather than merely unlikely.
    -- Ambiguity resolves to nobody rather than to a guess.
    select p.id into v_target
    from public.profiles p
    join public.organization_members om
      on om.user_id = p.id
     and om.organization_id = v_channel.organization_id
    where lower(coalesce(p.display_name, '')) = v_handle
       or lower(split_part(p.email, '@', 1)) = v_handle
    limit 1;

    if v_target is null or v_target = v_actor then
      continue;
    end if;

    -- Two handles can name the same person — a display name and an email
    -- local part — so the guard is the resolved id, not the text.
    if v_target = any (v_seen) then
      continue;
    end if;
    v_seen := v_seen || v_target;

    -- The whole reason this exists: never tell somebody about a message in a
    -- channel they cannot see. Suspended and banned members resolve to false
    -- inside can_in_channel_for, so they are excluded here too.
    if not public.can_in_channel_for(v_target, new.channel_id, 'channels.view') then
      continue;
    end if;

    -- The row is the durable part. ON CONFLICT rather than a lookup: on an
    -- edit the mention may already be recorded, and the primary key is the
    -- dedupe.
    insert into public.message_mentions (message_id, user_id, handle)
    values (new.id, v_target, v_handle)
    on conflict (message_id, user_id) do nothing;

    get diagnostics v_fresh = row_count;
    -- Already recorded means already notified. An edit that keeps a mention
    -- must not notify a second time.
    if not v_fresh then
      continue;
    end if;

    insert into public.notifications (
      organization_id, recipient_id, type, entity_type, entity_id,
      actor_id, summary, metadata
    )
    values (
      v_channel.organization_id,
      v_target,
      'mention',
      'message',
      new.id::text,
      v_actor,
      left(format('%s mentioned you in #%s', coalesce(v_name, 'Someone'), v_channel.name), 300),
      jsonb_build_object(
        'channel_id', new.channel_id,
        'channel_key', v_channel.key,
        'channel_name', v_channel.name,
        -- Safe to carry: this row only exists for someone who passed the
        -- check above and could therefore read the message itself.
        'excerpt', left(new.body, 160)
      )
    );
  end loop;

  return null;
end;
$fn$;

drop trigger if exists messages_mentions on public.messages;
create trigger messages_mentions
  after insert or update of body on public.messages
  for each row execute function public.tg_message_mentions();

-- --- And forgetting them ----------------------------------------------------
--
-- ROLLBACK: the original body of tg_message_soft_deleted is in
-- supabase/migrations/20250907001800_message_lifecycle.sql. The only addition
-- is the mention delete.
--
-- A deleted message has no words left to have mentioned anybody in. Leaving
-- the rows would keep a name highlighted against an empty body and would let
-- a later edit-triggered pass think the person had already been told.

create or replace function public.tg_message_soft_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- Restored rather than switched off: the calling routine may still be
  -- inside its own guarded section, and leaving the flag on would let a
  -- later statement in the same transaction bypass the column protection.
  v_previous text := coalesce(current_setting('lfghq.messaging', true), '');
begin
  delete from public.message_reactions where message_id = new.id;
  delete from public.message_mentions where message_id = new.id;

  if new.pinned_at is not null then
    perform set_config('lfghq.messaging', 'on', true);

    -- Does not recurse: this UPDATE leaves deleted_at unchanged, so the WHEN
    -- clause on the trigger is false on the second pass.
    update public.messages
    set pinned_at = null, pinned_by = null
    where id = new.id;

    perform set_config('lfghq.messaging', v_previous, true);
  end if;

  return null;
end;
$fn$;
