-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · Applying the rule to the rows that predate it
--
-- 20250912003300 decided that a direct message with no replies under it is
-- removed rather than tombstoned. A handful of rows were written between the
-- conversation schema landing and that decision, while the old rule was still
-- in force, and they are the only thing in the database the new rule has not
-- been applied to.
--
-- Strictly scoped to exactly what the routine would now do: a conversation
-- message, already soft-deleted, with nothing pointing at it. Channel messages
-- are not touched — their tombstones are the record of a moderation decision
-- and they stay.
--
-- Idempotent, and a no-op on any database where those rows do not exist.
-- ===========================================================================

delete from public.messages m
where m.conversation_id is not null
  and m.deleted_at is not null
  and not exists (
    select 1 from public.messages r where r.parent_message_id = m.id
  );
