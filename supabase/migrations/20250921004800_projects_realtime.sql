-- ===========================================================================
-- LFG HQ · Phase 6.4 · Projects, tasks and everything on them, kept current
--
-- No tables, no routines, no permissions: six lines of publication, and the
-- reasoning for them.
--
-- 1 · Postgres Changes evaluates RLS per subscriber.
--    Established for `calendar_events` in 5.3C by measurement, not by faith:
--    a member receives the row, an anonymous subscriber receives an empty
--    envelope carrying "Error 401: Unauthorized", and a deletion arrives as a
--    bare id to everybody. The same policies now scope these six.
--
-- 2 · It respects column privileges too.
--    That mattered here. 6.3 moved a deleted comment's words into
--    `deleted_body` and granted `authenticated` every column but that one, so
--    the question was whether a WAL payload would carry what a SELECT may not.
--    Measured before publishing anything: an INSERT and the UPDATE that
--    follows a soft delete both arrive with exactly the eight granted columns
--    and no `deleted_body`. The words never leave the database.
--
-- 3 · Replica identity stays default, on purpose.
--    That makes a DELETE arrive as a primary key and nothing else — the
--    smallest thing that can be said, and enough, because every client
--    refetches through RLS rather than reading the payload. FULL would put a
--    deleted row's whole content on the wire for no gain.
--
-- 4 · Nothing here is a permission.
--    A subscriber sees exactly the rows it could have selected. Realtime is
--    news that something changed; the query that follows is what decides what
--    that something was.
--
-- Additive only.
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
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_members'
  ) then
    alter publication supabase_realtime add table public.project_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_labels'
  ) then
    alter publication supabase_realtime add table public.project_labels;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_labels'
  ) then
    alter publication supabase_realtime add table public.task_labels;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_comments'
  ) then
    alter publication supabase_realtime add table public.task_comments;
  end if;
end $$;
