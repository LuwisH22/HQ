-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · A message belongs to exactly one context
--
-- Direct messages are messages. Not `dm_messages`, not a parallel table with
-- the same six columns and its own drifting copy of soft delete, editing,
-- threads, reactions, mentions and search — one table, with a second kind of
-- place a message can live in.
--
-- The rule is an XOR and the database states it:
--
--     exactly one of channel_id, conversation_id is populated
--
-- Everything downstream then asks "which context is this" once, in the places
-- that must branch, and nothing else changes. Visibility keeps inheriting the
-- way C1 built it — a message defers to its channel, or now to its
-- conversation — so there is still one implementation of each rule.
--
-- WHAT DOES NOT TRANSFER. `messages.moderate` is a channel permission and it
-- stays one: nobody moderates somebody else's direct messages, so a DM message
-- can be removed by its author and by no one else. Pinning is not a permission
-- inside a conversation either — the two people in it are the only people
-- there, so either may pin — and pinning writes no audit row for a DM, because
-- an audit row would tell every holder of the audit permission that a
-- conversation exists and when it was used.
--
-- EXISTING DATA. Every message written before this file has channel_id set and
-- conversation_id NULL, so the constraint is satisfied by construction; the
-- migration counts the rows that would violate it and refuses to continue if
-- there are any, rather than trusting that.
--
-- Five existing objects are replaced. Their original bodies are named for
-- rollback at each site. No existing behaviour changes for a channel message:
-- every branch added below is reached only when conversation_id is set.
-- ===========================================================================

-- --- The second context -----------------------------------------------------

alter table public.messages
  alter column channel_id drop not null;

alter table public.messages
  -- RESTRICT for the same reason threads use it: a hard delete that silently
  -- destroyed a correspondence is not a thing this schema should make easy.
  -- There is no routine that deletes a conversation, and this is why.
  add column conversation_id uuid references public.conversations (id) on delete restrict;

comment on column public.messages.conversation_id is
  'Set for a direct message, NULL for a channel message. Exactly one of channel_id and conversation_id is populated.';

do $$
declare
  v_bad bigint;
begin
  select count(*) into v_bad
  from public.messages
  where (channel_id is null and conversation_id is null)
     or (channel_id is not null and conversation_id is not null);

  if v_bad > 0 then
    raise exception
      'refusing to add the context constraint: % existing message(s) would violate it', v_bad;
  end if;
end $$;

alter table public.messages
  add constraint messages_one_context check (
    (channel_id is not null and conversation_id is null)
    or (channel_id is null and conversation_id is not null)
  );

-- The conversation timeline, and its pins. Mirrors the channel indexes rather
-- than inventing a different access pattern.
create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc, id desc)
  where conversation_id is not null;

create index messages_conversation_roots_idx
  on public.messages (conversation_id, created_at desc, id desc)
  where conversation_id is not null and parent_message_id is null;

create index messages_conversation_pinned_idx
  on public.messages (conversation_id, pinned_at desc)
  where conversation_id is not null and pinned_at is not null;

-- --- Policies ---------------------------------------------------------------
--
-- ROLLBACK: the three originals are in
-- supabase/migrations/20250905001300_message_schema.sql, verbatim, without the
-- conversation branch added to each.

drop policy if exists "Members can read messages in channels they can see" on public.messages;
create policy "Members can read messages in a place they can see"
  on public.messages for select to authenticated
  using (
    -- Both halves defer rather than re-deriving: the channels policy calls
    -- can_in_channel, the conversations policy calls can_in_conversation, and
    -- each is evaluated once per place rather than once per message.
    channel_id in (select id from public.channels)
    or conversation_id in (select id from public.conversations)
  );

drop policy if exists "Members can post where they may send" on public.messages;
create policy "Members can post where they may send"
  on public.messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (channel_id is not null and public.can_in_channel(channel_id, 'messages.send'))
      -- There is no send permission inside a conversation. Being in it is the
      -- permission, and being suspended or banned takes it away.
      or (conversation_id is not null and public.can_in_conversation(conversation_id))
    )
    and deleted_at is null
    and pinned_at is null
    and edited_at is null
  );

drop policy if exists "Authors can edit their own message" on public.messages;
create policy "Authors can edit their own message"
  on public.messages for update to authenticated
  using (
    author_id = (select auth.uid())
    and deleted_at is null
    and (
      (channel_id is not null and public.can_in_channel(channel_id, 'messages.send'))
      or (conversation_id is not null and public.can_in_conversation(conversation_id))
    )
  )
  with check (author_id = (select auth.uid()));

-- --- One more column a client may not write ---------------------------------
--
-- ROLLBACK: the previous body of this function is in
-- supabase/migrations/20250910002800_threads.sql. The only change is the
-- conversation_id clause.

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
     -- Moving a message between contexts would carry it out of the
     -- authorization that admitted it. There is no operation that does this.
     or new.conversation_id is distinct from old.conversation_id
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at
     or new.pinned_at is distinct from old.pinned_at
     or new.pinned_by is distinct from old.pinned_by
     or new.deleted_at is distinct from old.deleted_at
     or new.deleted_by is distinct from old.deleted_by
     or new.parent_message_id is distinct from old.parent_message_id
     or new.reply_count is distinct from old.reply_count
     or new.last_reply_at is distinct from old.last_reply_at then
    raise exception
      'Only the message body may be edited. Use delete_message() or pin_message().'
      using errcode = 'insufficient_privilege';
  end if;

  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;

  return new;
end;
$fn$;

-- --- A reply lives where its root lives -------------------------------------
--
-- ROLLBACK: the previous body is in
-- supabase/migrations/20250910002800_threads.sql. The channel comparison
-- becomes a comparison of both context columns.

create or replace function public.tg_message_thread_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_parent public.messages;
begin
  new.reply_count := 0;
  new.last_reply_at := null;

  if new.parent_message_id is null then
    return new;
  end if;

  select * into v_parent from public.messages where id = new.parent_message_id;

  if v_parent is null then
    raise exception 'That message no longer exists' using errcode = 'no_data_found';
  end if;

  if v_parent.parent_message_id is not null then
    raise exception 'A reply cannot itself be replied to'
      using errcode = 'check_violation';
  end if;

  -- Both columns, not just the channel: with channel_id nullable, two direct
  -- messages in different conversations would otherwise compare equal on NULL
  -- and a reply could be attached across conversations.
  if v_parent.channel_id is distinct from new.channel_id
     or v_parent.conversation_id is distinct from new.conversation_id then
    raise exception 'A reply must be in the same place as the message it replies to'
      using errcode = 'check_violation';
  end if;

  if v_parent.deleted_at is not null then
    raise exception 'That message has been deleted' using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

-- --- Reactions carry the context too ----------------------------------------
--
-- channel_id was denormalised onto the reaction so a realtime subscription
-- could filter on it. The same reasoning gives conversation_id the same
-- treatment, and the same trigger stamps whichever one the message has. A
-- client still supplies neither.

alter table public.message_reactions
  alter column channel_id drop not null;

alter table public.message_reactions
  add column conversation_id uuid references public.conversations (id) on delete cascade;

do $$
declare
  v_bad bigint;
begin
  select count(*) into v_bad
  from public.message_reactions
  where (channel_id is null and conversation_id is null)
     or (channel_id is not null and conversation_id is not null);

  if v_bad > 0 then
    raise exception
      'refusing to add the context constraint: % existing reaction(s) would violate it', v_bad;
  end if;
end $$;

alter table public.message_reactions
  add constraint message_reactions_one_context check (
    (channel_id is not null and conversation_id is null)
    or (channel_id is null and conversation_id is not null)
  );

-- ROLLBACK: the original body is in
-- supabase/migrations/20250907001700_message_reactions.sql.

create or replace function public.tg_reaction_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_message public.messages;
begin
  select * into v_message from public.messages where id = new.message_id;

  if v_message is null then
    raise exception 'Message not found' using errcode = 'no_data_found';
  end if;

  -- Whichever the message has. The XOR on messages is what makes this an
  -- assignment rather than a decision.
  new.channel_id := v_message.channel_id;
  new.conversation_id := v_message.conversation_id;

  return new;
end;
$fn$;

-- ROLLBACK: the original policy is in
-- supabase/migrations/20250907001700_message_reactions.sql.

drop policy if exists "Members can react where they may send" on public.message_reactions;
create policy "Members can react where they may send"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.messages m
      where m.id = message_id
        and m.deleted_at is null
        and (
          (m.channel_id is not null and public.can_in_channel(m.channel_id, 'messages.send'))
          or (m.conversation_id is not null and public.can_in_conversation(m.conversation_id))
        )
    )
  );

-- --- Removing and pinning ---------------------------------------------------
--
-- ROLLBACK: both original bodies are in
-- supabase/migrations/20250905001400_message_routines.sql.

create or replace function public.delete_message(p_message_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_message      public.messages;
  v_channel      public.channels;
  v_actor        uuid := (select auth.uid());
  v_is_author    boolean;
  v_can_moderate boolean := false;
begin
  select * into v_message from public.messages where id = p_message_id;
  if v_message is null then
    raise exception 'Message not found' using errcode = 'no_data_found';
  end if;
  if v_message.deleted_at is not null then
    raise exception 'That message has already been deleted' using errcode = 'check_violation';
  end if;

  v_is_author := v_message.author_id is not null and v_message.author_id = v_actor;

  if v_message.channel_id is not null then
    -- Reading the channel is the floor: a message in a channel you cannot see
    -- is not yours to act on, whatever else you hold.
    if not public.can_in_channel(v_message.channel_id, 'channels.view') then
      raise exception 'You do not have access to that channel'
        using errcode = 'insufficient_privilege';
    end if;

    select * into v_channel from public.channels where id = v_message.channel_id;
    v_can_moderate := public.can_in_channel(v_message.channel_id, 'messages.moderate');
  else
    -- No moderation inside a conversation. `messages.moderate` is a channel
    -- permission and granting it must not hand somebody the power to edit the
    -- record of other people's private correspondence.
    if not public.can_in_conversation(v_message.conversation_id) then
      raise exception 'You do not have access to that conversation'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if not v_is_author and not v_can_moderate then
    raise exception 'You can only delete your own messages'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('lfghq.messaging', 'on', true);
  update public.messages
  set body       = '',
      deleted_at = now(),
      deleted_by = v_actor
  where id = p_message_id;
  perform set_config('lfghq.messaging', 'off', true);

  -- Only moderation is worth a permanent record, and moderation only happens
  -- in a channel — so a direct message never writes one. An audit row for a
  -- DM would tell every holder of the audit permission that a conversation
  -- exists and when it was used.
  if not v_is_author and v_message.channel_id is not null then
    perform public.log_audit_event(
      v_channel.organization_id, 'message.deleted', 'message', p_message_id::text,
      format('Message removed from %s', v_channel.name),
      jsonb_build_object(
        'channel', v_channel.name,
        'author_id', v_message.author_id,
        'reason', nullif(btrim(coalesce(p_reason, '')), '')
      )
    );
  end if;
end;
$fn$;

create or replace function public.pin_message(p_message_id uuid, p_pinned boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_message public.messages;
  v_channel public.channels;
begin
  select * into v_message from public.messages where id = p_message_id;
  if v_message is null then
    raise exception 'Message not found' using errcode = 'no_data_found';
  end if;
  if v_message.deleted_at is not null then
    raise exception 'A deleted message cannot be pinned' using errcode = 'check_violation';
  end if;

  if v_message.channel_id is not null then
    -- Channel-scoped, so an override can grant or withhold it per channel.
    if not public.can_in_channel(v_message.channel_id, 'messages.pin') then
      raise exception 'You do not have permission to pin messages here'
        using errcode = 'insufficient_privilege';
    end if;

    select * into v_channel from public.channels where id = v_message.channel_id;
  else
    -- Pinning is not a permission in a conversation: the people in it are the
    -- only people there, and either may keep something at the top.
    if not public.can_in_conversation(v_message.conversation_id) then
      raise exception 'You do not have access to that conversation'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  perform set_config('lfghq.messaging', 'on', true);
  update public.messages
  set pinned_at = case when p_pinned then now() else null end,
      pinned_by = case when p_pinned then (select auth.uid()) else null end
  where id = p_message_id;
  perform set_config('lfghq.messaging', 'off', true);

  -- A conversation writes no audit row, for the same reason a deletion in one
  -- does not.
  if v_message.channel_id is not null then
    perform public.log_audit_event(
      v_channel.organization_id,
      case when p_pinned then 'message.pinned' else 'message.unpinned' end,
      'message', p_message_id::text,
      format('%s a message in %s', case when p_pinned then 'Pinned' else 'Unpinned' end,
             v_channel.name),
      jsonb_build_object('channel', v_channel.name)
    );
  end if;
end;
$fn$;

-- --- Mentions in a conversation ---------------------------------------------
--
-- ROLLBACK: the previous body is in
-- supabase/migrations/20250911002900_message_mentions.sql. Two things change:
-- the organization and the eligibility gate are read from whichever context
-- the message is in, and the notification says where it happened accordingly.
--
-- The gate is the whole point, and it is the right one for each place: in a
-- channel, could this person read it; in a conversation, are they in it. A
-- mention of somebody who is not in the conversation resolves to nobody, so
-- naming a colleague in a DM neither records a row nor sends them anything.

create or replace function public.tg_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_channel public.channels;
  v_org     uuid;
  v_where   text;
  v_meta    jsonb;
  v_actor   uuid := new.author_id;
  v_name    text;
  v_handle  text;
  v_target  uuid;
  v_seen    uuid[] := '{}';
  v_fresh   boolean;
  v_ok      boolean;
begin
  if new.deleted_at is not null or coalesce(new.body, '') = '' then
    return null;
  end if;

  if new.channel_id is not null then
    select * into v_channel from public.channels where id = new.channel_id;
    if v_channel is null then
      return null;
    end if;
    v_org := v_channel.organization_id;
    v_where := '#' || v_channel.name;
    v_meta := jsonb_build_object(
      'channel_id', new.channel_id,
      'channel_key', v_channel.key,
      'channel_name', v_channel.name
    );
  else
    select organization_id into v_org
    from public.conversations where id = new.conversation_id;
    if v_org is null then
      return null;
    end if;
    v_where := 'a direct message';
    -- No name to carry: a conversation is identified by who is in it, and the
    -- recipient is one of them.
    v_meta := jsonb_build_object('conversation_id', new.conversation_id);
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
    select p.id into v_target
    from public.profiles p
    join public.organization_members om
      on om.user_id = p.id
     and om.organization_id = v_org
    where lower(coalesce(p.display_name, '')) = v_handle
       or lower(split_part(p.email, '@', 1)) = v_handle
    limit 1;

    if v_target is null or v_target = v_actor then
      continue;
    end if;

    if v_target = any (v_seen) then
      continue;
    end if;
    v_seen := v_seen || v_target;

    -- Never tell somebody about a message in a place they are not in.
    if new.channel_id is not null then
      v_ok := public.can_in_channel_for(v_target, new.channel_id, 'channels.view');
    else
      v_ok := public.can_in_conversation_for(v_target, new.conversation_id);
    end if;

    if not v_ok then
      continue;
    end if;

    insert into public.message_mentions (message_id, user_id, handle)
    values (new.id, v_target, v_handle)
    on conflict (message_id, user_id) do nothing;

    get diagnostics v_fresh = row_count;
    if not v_fresh then
      continue;
    end if;

    insert into public.notifications (
      organization_id, recipient_id, type, entity_type, entity_id,
      actor_id, summary, metadata
    )
    values (
      v_org,
      v_target,
      'mention',
      'message',
      new.id::text,
      v_actor,
      left(format('%s mentioned you in %s', coalesce(v_name, 'Someone'), v_where), 300),
      v_meta || jsonb_build_object('excerpt', left(new.body, 160))
    );
  end loop;

  return null;
end;
$fn$;
