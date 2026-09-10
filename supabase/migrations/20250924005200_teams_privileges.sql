-- ===========================================================================
-- LFG HQ · Phase 7.1 · Teams: taking away what was never meant to be there
--
-- A client holds no business writing either of these tables — every change
-- goes through a routine — and row level security already refuses it. But
-- this project's default privileges hand `authenticated` the full set on any
-- new table in `public`, so the refusal was coming from the policies alone,
-- and it did not look the same from both ends:
--
--   insert  → refused, loudly, because there is no insert policy to satisfy
--   update  → no error, and no rows changed
--   delete  → no error, and no rows deleted
--
-- Nothing was ever at risk; a write that changes nothing is a write that
-- changed nothing. But it returns success to whoever asked, which is the kind
-- of quiet that hides a mistake for a while. Taking the privileges away makes
-- all three refuse in the same voice.
--
-- Only teams. The same is true of `projects` and several tables before it, and
-- fixing those belongs to a change about them rather than to this one.
--
-- Additive only: nothing here grants anything that was not already granted.
-- ===========================================================================

revoke insert, update, delete, truncate, references, trigger
  on public.teams from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.team_members from anon, authenticated;

-- Reading stays exactly as it was, scoped by the policies in 20250924005100.
grant select on public.teams to authenticated;
grant select on public.team_members to authenticated;
