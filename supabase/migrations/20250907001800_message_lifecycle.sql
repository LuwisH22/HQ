-- ===========================================================================
-- LFG HQ · Phase 2 · C2 · What a soft delete takes with it
--
-- C1's delete_message clears the body but leaves everything hanging off the
-- message in place. That was invisible while nothing hung off it. Now two
-- things do:
--
--   * a pinned message that is deleted stays pinned, so the channel panel
--     would list a pin pointing at words nobody can read;
--   * reaction counts on an empty row are noise about nothing.
--
-- Both go with the body. Written as a trigger rather than an edit to
-- delete_message so the C1 routine is left exactly as it was — and so any
-- other path to a soft delete gets the same treatment for free.
--
-- Additive only.
-- ===========================================================================

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

  if new.pinned_at is not null then
    perform set_config('lfghq.messaging', 'on', true);

    -- Does not recurse: this UPDATE leaves deleted_at unchanged, so the WHEN
    -- clause on the trigger below is false on the second pass.
    update public.messages
    set pinned_at = null, pinned_by = null
    where id = new.id;

    perform set_config('lfghq.messaging', v_previous, true);
  end if;

  return null;
end;
$fn$;

create trigger messages_soft_deleted
  after update of deleted_at on public.messages
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.tg_message_soft_deleted();
