-- ===========================================================================
-- LFG HQ · Phase 6.5 · Project lifecycle, review, and real deletion
--
-- 6.1 gave a project a `status` and let `update_project` set it to anything.
-- That is a label, not a lifecycle: nothing stopped a project going from
-- planned straight to completed, and nothing recorded that a review had ever
-- happened. This turns the label into a workflow the database owns.
--
--   planned → in_progress → in_review → done
--                  ↑              │
--                  └──────────────┘   (changes requested)
--
-- Six decisions.
--
-- 1 · Archived leaves the lifecycle.
--    It was a fifth status, which meant archiving destroyed the answer to
--    "where had this got to?". It is now `archived_at`, so a project is at a
--    stage *and* either put away or not — "done and archived" and "done and
--    active" are both sayable, and restoring returns a project to the stage it
--    was at rather than guessing one.
--
-- 2 · The client cannot set a status at all.
--    `update_project` loses its status argument entirely — not a check inside
--    it, the argument. A routine that still accepted one would be a bypass
--    waiting for somebody to call it directly, and PostgREST exposes every
--    argument to anybody with the anon key.
--
-- 3 · Deadlines are made here or not at all.
--    `transition_project` computes `review_deadline_at` from `now()` and a
--    duration in minutes. Nothing accepts a timestamp from a browser, so no
--    clock a user controls can bring a completion forward.
--
-- 4 · Completion is gated on the deadline, and the gate is here.
--    A countdown on a screen is presentation. `in_review → done` re-reads the
--    deadline from the row and refuses if it has not passed. A review started
--    with no limit has no deadline and therefore no gate — that is what "no
--    limit" means.
--
-- 5 · Review talk is its own table.
--    `task_comments` is about a task. A project review is about the project,
--    and overloading one for the other would make "which task?" unanswerable.
--    The new table copies that table's privacy model exactly, including the
--    `deleted_body` column no client is granted.
--
-- 6 · Delete is real, and the record outlives the row.
--    Every child table already cascades from `projects`, so the routine does
--    not enumerate them; what it does do is write the audit event before the
--    delete, in the same transaction, so the entry survives what it describes.
--
-- Additive except where noted: `update_project` is dropped and recreated
-- without its status argument, and `projects.status` is remapped in place.
-- ===========================================================================

-- --- The lifecycle on the row ----------------------------------------------

alter table public.projects
  add column if not exists archived_at            timestamptz,
  add column if not exists review_started_at      timestamptz,
  add column if not exists review_deadline_at     timestamptz,
  add column if not exists review_duration_minutes integer,
  -- Which round of review the project is on, so a comment can say which
  -- conversation it belonged to without a versioning system.
  add column if not exists review_round           integer not null default 0;

comment on column public.projects.archived_at is
  'When the project was put away, or null. Independent of the lifecycle stage, which archiving no longer overwrites.';
comment on column public.projects.review_deadline_at is
  'When the current review period ends. Computed by transition_project from now(); never accepted from a client.';
comment on column public.projects.review_round is
  'How many times this project has been sent to review. Stamped on review comments so rounds stay legible.';

-- The old five statuses become four stages plus a flag.
--
-- `archived` carried no memory of where a project had got to — the old
-- routine recorded the previous status in its audit entry and nowhere else —
-- so an archived row maps to the terminal stage, which is the closest true
-- thing available. The live database held no projects at all when this ran,
-- so no real row was guessed at.
alter table public.projects drop constraint if exists projects_status_valid;

update public.projects set archived_at = updated_at where status = 'archived';
update public.projects set status = 'in_progress' where status = 'active';
update public.projects set status = 'done'        where status in ('completed', 'archived');

alter table public.projects
  add constraint projects_status_valid check (
    status in ('planned', 'in_progress', 'in_review', 'done'));

alter table public.projects
  drop constraint if exists projects_review_state_valid,
  add constraint projects_review_state_valid check (
    -- A project in review has been sent there; a deadline implies a start.
    (status <> 'in_review' or review_started_at is not null)
    and (review_deadline_at is null or review_started_at is not null)
    and (review_duration_minutes is null or review_duration_minutes > 0)
    and review_round >= 0
  );

-- The list groups by stage and hides what has been put away.
create index if not exists projects_org_archived_idx
  on public.projects (organization_id, archived_at);
