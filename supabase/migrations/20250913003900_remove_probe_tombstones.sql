-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · The second, and last, probe tombstone
--
-- 20250913003800 removed the first one and said the probe had been changed to
-- create its own channel. The change had not in fact been written to disk when
-- the probe ran again, so it produced one more before it was fixed properly.
--
-- Same predicate, both ids named: deleted, empty, and with nothing pointing at
-- it. The first is already gone, so that half is a no-op, and the statement is
-- a no-op anywhere either row is not exactly what is described. The probe now
-- creates and deletes its own channel, which is how every other live check has
-- always worked, so there is no third.
--
-- Nothing else is touched. A tombstone a person left by deleting their own
-- message is the record of that decision and stays.
-- ===========================================================================

delete from public.messages m
where m.id in (
    '8e86fa4b-8e6c-42c3-9baf-cd18b5e5856a',
    'b80dc50b-e0da-41b2-a298-8ac0f9aa2101'
  )
  and m.channel_id is not null
  and m.deleted_at is not null
  and m.body = ''
  and not exists (
    select 1 from public.messages r where r.parent_message_id = m.id
  );
