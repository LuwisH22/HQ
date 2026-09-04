-- ===========================================================================
-- LFG HQ · Phase 1.5 · B2 · Add 'banned' to member_status
--
-- This migration does exactly one thing, on purpose.
--
-- PostgreSQL will not let a newly added enum value be *used* in the same
-- transaction that adds it, and the Supabase CLI wraps each migration file in
-- a transaction. Anything referencing 'banned' therefore has to live in a
-- later file.
--
-- Note for the record: `ALTER TYPE ... DROP VALUE` does not exist in
-- PostgreSQL, so this addition is permanent. It is additive and breaks
-- nothing — existing rows keep their current status — but it cannot be rolled
-- back the way the rest of B2 can.
-- ===========================================================================

alter type public.member_status add value if not exists 'banned';
