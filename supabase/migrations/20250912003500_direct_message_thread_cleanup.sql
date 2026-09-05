-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · A placeholder with nothing left to open
--
-- 20250912003300 removes a direct message that has no replies under it, and
-- keeps one that does — the placeholder is what makes the replies reachable.
-- It left one case behind: delete the root of a thread, then delete every
-- reply, and the placeholder stays forever as the opening of a conversation
-- nobody had. It is not evidence of anything and there is nothing under it.
--
-- So the last reply takes it with it. Written in the routine rather than as a
-- trigger on the table: a trigger that deletes from the table it fires on is
-- a re-entrancy problem waiting to happen, and this is one statement.
--
-- Channels are untouched. Their tombstones are the record of a moderation
-- decision and they stay.
--
-- ROLLBACK: restore delete_message verbatim from
-- supabase/migrations/20250912003300_direct_message_deletion.sql.
-- ===========================================================================

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
  -- themselves alive, and a root whose replies were all deleted still has
  -- rows pointing at it that ON DELETE RESTRICT would refuse.
  select exists (
    select 1 from public.messages r where r.parent_message_id = p_message_id
  ) into v_has_replies;

  perform set_config('lfghq.messaging', 'on', true);

  if v_message.conversation_id is not null and not v_has_replies then
    -- Reactions and mentions cascade; there is nothing left to point at it.
    delete from public.messages where id = p_message_id;

    -- And if it was the last reply under a placeholder, the placeholder is
    -- the opening of a thread that no longer exists.
    if v_message.parent_message_id is not null then
      delete from public.messages r
      where r.id = v_message.parent_message_id
        and r.conversation_id is not null
        and r.deleted_at is not null
        and not exists (
          select 1 from public.messages c where c.parent_message_id = r.id
        );
    end if;
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
