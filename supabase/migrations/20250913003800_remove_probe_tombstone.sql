-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · Removing a tombstone a probe left in a real channel
--
-- While checking the attachment stack against the live project, a probe wrote
-- a message into an existing channel and soft-deleted it. That is the correct
-- behaviour for a channel — a tombstone is the record that a message was
-- removed — but this one is a record of nothing: it was written by a script,
-- to nobody, and it sits in the middle of a conversation people actually had.
--
-- There is no client path to remove it. delete_message soft-deletes a channel
-- message by design and refuses one that is already deleted, and only deleting
-- the channel would take it, which is not on offer for a channel in use.
--
-- So it is named by id, and the predicate is narrow enough that the statement
-- is a no-op anywhere the row is not exactly what is described: deleted,
-- empty, and with nothing pointing at it. The probe has since been changed to
-- create and delete its own channel, which is how every other live check has
-- always worked.
-- ===========================================================================

delete from public.messages m
where m.id = '8e86fa4b-8e6c-42c3-9baf-cd18b5e5856a'
  and m.channel_id is not null
  and m.deleted_at is not null
  and m.body = ''
  and not exists (
    select 1 from public.messages r where r.parent_message_id = m.id
  );
