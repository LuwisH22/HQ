-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · Deleting a direct message deletes it
--
-- A soft delete exists for two reasons, and neither of them is true inside a
-- conversation.
--
--   It keeps the evidence that a moderation decision was made. There is no
--   moderation in a DM: `messages.moderate` does not reach into one, the
--   author is the only person who can remove their own words, and the routine
--   writes no audit row precisely so that a conversation's existence is not
--   announced to everyone holding the audit permission. There is nothing for
--   a tombstone to be evidence of.
--
--   It keeps replies reachable by leaving their root in place. That reason
--   still holds, and is the one case below that keeps behaving as before.
--
-- What is left over is a line reading "This message was deleted." in a private
-- conversation between two people who both already know. It is not a record,
-- it is a residue.
--
-- So: in a conversation, a message with no replies under it is removed. A
-- message that has replies is soft-deleted exactly as before, because the
-- thread has to survive. In a channel nothing changes at all.
--
-- Two objects are replaced. delete_message gains one branch; the thread
-- counter learns that a row can now disappear, and gets an AFTER DELETE
-- trigger so a root's reply count still describes the rows that exist.
--
-- ROLLBACK: delete_message is in
-- supabase/migrations/20250912003100_conversation_messages.sql and
-- tg_message_thread_counter in
-- supabase/migrations/20250910002800_threads.sql; drop the trigger added here.
-- ===========================================================================

create or replace function public.tg_message_thread_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- NEW is unassigned in an AFTER DELETE trigger, so the row being described
  -- has to be chosen by operation rather than by coalesce.
  v_root uuid := case
                   when tg_op = 'DELETE' then old.parent_message_id
                   else new.parent_message_id
                 end;
  v_previous text := coalesce(current_setting('lfghq.messaging', true), '');
begin
  if v_root is null then
    return null;
  end if;

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

-- A reply that is gone stops counting, the same way a soft-deleted one does.
create trigger messages_thread_uncounted
  after delete on public.messages
  for each row
  when (old.parent_message_id is not null)
  execute function public.tg_message_thread_counter();

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
  v_has_replies  boolean;
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

  -- Existence, not the counter: reply_count only counts replies that are
  -- themselves alive, and a root whose replies were all soft-deleted still
  -- has rows pointing at it that ON DELETE RESTRICT would refuse.
  select exists (
    select 1 from public.messages r where r.parent_message_id = p_message_id
  ) into v_has_replies;

  perform set_config('lfghq.messaging', 'on', true);

  if v_message.conversation_id is not null and not v_has_replies then
    -- Reactions and mentions cascade; there is nothing left to point at it.
    delete from public.messages where id = p_message_id;
  else
    update public.messages
    set body       = '',
        deleted_at = now(),
        deleted_by = v_actor
    where id = p_message_id;
  end if;

  perform set_config('lfghq.messaging', 'off', true);

  -- Only moderation is worth a permanent record, and moderation only happens
  -- in a channel — so a direct message never writes one.
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
