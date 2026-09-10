-- ===========================================================================
-- LFG HQ · Phase 7.4 · Teams and rosters, kept current
--
-- Two lines of publication and the reasoning for them. No tables, no routines,
-- no permissions: 7.1 through 7.3 built all of that, and realtime is not a new
-- way to reach any of it.
--
-- 1 · Postgres Changes evaluates RLS per subscriber.
--    Established by measurement for `calendar_events` in 5.3C and for the six
--    project tables in 6.4: a member receives the row, an anonymous subscriber
--    receives an empty envelope carrying "Error 401: Unauthorized", and a
--    deletion arrives as a bare key to everybody who may read the table. The
--    same policies now scope these two — `teams.view` on the team's own
--    organization, and for a roster row the same question asked through
--    `team_organization()`.
--
-- 2 · Replica identity stays default, and here that is unusually convenient.
--    A delete publishes the primary key and nothing else. For `tasks` that is
--    one column and a client cannot tell which project lost a row; for
--    `team_members` the primary key is `(team_id, member_id)`, so a removal
--    arrives already saying which roster changed. The narrowest possible
--    payload is also the most useful one here, which is a good reason not to
--    widen it: FULL would put a departing member's position and status on the
--    wire for no gain.
--
-- 3 · Nothing here is a permission.
--    A subscriber sees exactly the rows it could have selected. Realtime is
--    news that something changed; the query that follows is what decides what
--    that something was, and it goes through RLS like every other read.
--
-- Additive, and it touches no other table's membership of the publication.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  -- `alter publication ... add table` throws if the table is already there, so
  -- each one is checked. The script that verifies this reads the same view.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teams'
  ) then
    alter publication supabase_realtime add table public.teams;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_members'
  ) then
    alter publication supabase_realtime add table public.team_members;
  end if;
end $$;
