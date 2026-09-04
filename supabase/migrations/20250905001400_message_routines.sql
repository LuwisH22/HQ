-- ===========================================================================
-- LFG HQ · Phase 2 · C1 · Message routines
--
-- Two operations that RLS alone cannot express safely:
--
--   delete_message — an author may remove their own message, and a moderator
--     may remove anyone's. Both clear the body rather than the row, so replies
--     survive and the decision stays visible. Only the moderator case is
--     audited: logging every author tidying up their own typo would bury the
--     entries that matter.
--
--   pin_message — a channel-scoped capability (`messages.pin`), so it is
--     resolved through can_in_channel rather than at organization level.
--
-- Ordinary sending and editing deliberately do NOT go through routines. That
-- is a departure from B1–B3, where every write was a routine because every
-- write changed someone's authority. A chat message is user content: it needs
-- no audit row, and routing thousands of them through plpgsql would buy
-- nothing but latency.
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
  v_can_moderate boolean;
begin
  select * into v_message from public.messages where id = p_message_id;
  if v_message is null then
    raise exception 'Message not found' using errcode = 'no_data_found';
  end if;
  if v_message.deleted_at is not null then
    raise exception 'That message has already been deleted' using errcode = 'check_violation';
  end if;

  select * into v_channel from public.channels where id = v_message.channel_id;

  -- Reading the channel is the floor: a message in a channel you cannot see is
  -- not yours to act on, whatever else you hold.
  if not public.can_in_channel(v_message.channel_id, 'channels.view') then
    raise exception 'You do not have access to that channel'
      using errcode = 'insufficient_privilege';
  end if;

  v_is_author := v_message.author_id is not null and v_message.author_id = v_actor;
  v_can_moderate := public.can_in_channel(v_message.channel_id, 'messages.moderate');

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

  -- Only moderation is worth a permanent record.
  if not v_is_author then
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

  -- Channel-scoped, so an override can grant or withhold it per channel.
  if not public.can_in_channel(v_message.channel_id, 'messages.pin') then
    raise exception 'You do not have permission to pin messages here'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_channel from public.channels where id = v_message.channel_id;

  perform set_config('lfghq.messaging', 'on', true);
  update public.messages
  set pinned_at = case when p_pinned then now() else null end,
      pinned_by = case when p_pinned then (select auth.uid()) else null end
  where id = p_message_id;
  perform set_config('lfghq.messaging', 'off', true);

  perform public.log_audit_event(
    v_channel.organization_id,
    case when p_pinned then 'message.pinned' else 'message.unpinned' end,
    'message', p_message_id::text,
    format('%s a message in %s', case when p_pinned then 'Pinned' else 'Unpinned' end,
           v_channel.name),
    jsonb_build_object('channel', v_channel.name)
  );
end;
$fn$;

revoke execute on function public.delete_message(uuid, text) from public, anon;
revoke execute on function public.pin_message(uuid, boolean) from public, anon;

grant execute on function public.delete_message(uuid, text) to authenticated;
grant execute on function public.pin_message(uuid, boolean) to authenticated;
