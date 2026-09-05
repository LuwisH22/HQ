-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · The same sweep, once more
--
-- 20250912003400 applied "a direct message with no replies under it is not
-- tombstoned" to the rows written before that rule existed. 20250912003500
-- then found the case it had missed — a thread root deleted first and emptied
-- afterwards — and closed it going forward.
--
-- Between those two migrations a placeholder of exactly that shape was
-- created, and neither file removes it: the first had already run, and the
-- second only governs deletions from now on. This is the same statement as
-- 20250912003400, run once more, so no database is left holding a row the
-- current rule would never produce.
--
-- Identical predicate, deliberately. Idempotent, and a no-op wherever those
-- rows do not exist. Channel tombstones are the record of a moderation
-- decision and are not touched.
-- ===========================================================================

delete from public.messages m
where m.conversation_id is not null
  and m.deleted_at is not null
  and not exists (
    select 1 from public.messages r where r.parent_message_id = m.id
  );
