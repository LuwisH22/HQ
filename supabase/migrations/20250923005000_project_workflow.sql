-- ===========================================================================
-- LFG HQ · Phase 6.5 · The workflow itself
--
-- 20250922004900 put the lifecycle on the row. This is everything that moves
-- it: one transition routine, archive and its opposite, a real delete, the
-- review conversation, and one read the list needs.
--
-- Nothing here introduces a permission. `projects.view`, `projects.manage`
-- and `projects.delete` have been in the catalogue since 20250901000200, and
-- the catalogue's own words for the last of those are "Archive or delete a
-- project" — which is now literally true.
--
-- Additive except for `update_project`, which is dropped and recreated
-- without the status argument that made the whole lifecycle optional.
-- ===========================================================================

-- --- The four stages -------------------------------------------------------

create or replace function public.assert_valid_project_status(p_status text)
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_status not in ('planned', 'in_progress', 'in_review', 'done') then
    raise exception 'Unknown project stage: %', coalesce(p_status, '(null)')
      using errcode = 'check_violation';
  end if;
end;
$fn$;

comment on function public.assert_valid_project_status is
  'Refuses a lifecycle stage this product does not have, as a sentence rather than as a constraint violation.';

-- --- Archived is a column now, not a stage ---------------------------------
--
-- The one line in the task gate that asked about status. Everything else in
-- 6.2 and 6.3 goes through this function, so this is the whole change: an
-- archived project still keeps what it has and still takes nothing new.

create or replace function public.assert_may_write_task(
  p_project public.projects,
  p_permission text,
  p_what text
)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_project.id is null then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(p_project.organization_id, p_permission) then
    raise exception 'You do not have permission to % on this project', p_what
      using errcode = 'insufficient_privilege';
  end if;

  if p_project.archived_at is not null then
    raise exception 'That project is archived' using errcode = 'check_violation';
  end if;
end;
$fn$;

comment on function public.assert_may_write_task is
  'The single gate on every task write: the project exists, the caller holds the permission in its organization, and the project is not archived.';

-- --- Starting somewhere sensible -------------------------------------------

create or replace function public.create_project(
  p_organization_id uuid,
  p_name text,
  p_description text default null,
  p_status text default 'planned',
  p_start_date date default null,
  p_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_status  text := lower(coalesce(nullif(btrim(p_status), ''), 'planned'));
  v_id      uuid;
  v_member  uuid;
  v_actor   uuid := (select auth.uid());
begin
  if not public.has_org_permission(p_organization_id, 'projects.create') then
    raise exception 'You do not have permission to create projects'
      using errcode = 'insufficient_privilege';
  end if;

  if v_name = '' then
    raise exception 'A project needs a name' using errcode = 'check_violation';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'Keep the name under 120 characters' using errcode = 'check_violation';
  end if;

  perform public.assert_valid_project_status(v_status);

  -- A project may start at the beginning, or already under way for work that
  -- was happening before anybody wrote it down. It may not start reviewed or
  -- finished: those are places the workflow arrives at, and starting there
  -- would be the jump this phase exists to prevent.
  if v_status not in ('planned', 'in_progress') then
    raise exception 'A new project starts planned or in progress'
      using errcode = 'check_violation';
  end if;

  if p_start_date is not null and p_due_date is not null and p_due_date < p_start_date then
    raise exception 'A project cannot be due before it starts' using errcode = 'check_violation';
  end if;

  insert into public.projects
    (organization_id, name, description, status, start_date, due_date, created_by)
  values
    (p_organization_id, v_name,
     nullif(btrim(coalesce(p_description, '')), ''),
     v_status, p_start_date, p_due_date, v_actor)
  returning id into v_id;

  select m.id into v_member
  from public.organization_members m
  where m.organization_id = p_organization_id and m.user_id = v_actor;

  if v_member is not null then
    insert into public.project_members (project_id, member_id, added_by)
    values (v_id, v_member, v_actor)
    on conflict do nothing;
  end if;

  perform public.log_audit_event(
    p_organization_id, 'project.created', 'project', v_id::text,
    format('Project %s created', v_name),
    jsonb_build_object('name', v_name, 'status', v_status,
                       'start_date', p_start_date, 'due_date', p_due_date)
  );
  return v_id;
end;
$fn$;

revoke execute on function public.create_project(uuid, text, text, text, date, date)
  from public, anon;
grant execute on function public.create_project(uuid, text, text, text, date, date)
  to authenticated;

-- --- Editing, with no way to change the stage ------------------------------
--
-- Dropped rather than replaced. Leaving `p_status` in place and rejecting it
-- inside would still publish an argument called "status" on an endpoint
-- anybody with the anon key can read, and the next person to relax the check
-- would have reopened the whole lifecycle. There is no argument to relax.

drop function if exists public.update_project(uuid, text, text, text, date, date, boolean, boolean);

create or replace function public.update_project(
  p_project_id uuid,
  p_name text default null,
  p_description text default null,
  p_start_date date default null,
  p_due_date date default null,
  p_clear_start_date boolean default false,
  p_clear_due_date boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project public.projects;
  v_name    text;
  v_start   date;
  v_due     date;
begin
  select * into v_project from public.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'Project not found' using errcode = 'no_data_found';
  end if;

  -- Absent and forbidden look the same to somebody in another organization:
  -- has_org_permission is false for both.
  if not public.has_org_permission(v_project.organization_id, 'projects.manage') then
    raise exception 'You do not have permission to change this project'
      using errcode = 'insufficient_privilege';
  end if;

  if v_project.archived_at is not null then
    raise exception 'That project is archived' using errcode = 'check_violation';
  end if;

  v_name  := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_project.name);
  v_start := case when p_clear_start_date then null
                  else coalesce(p_start_date, v_project.start_date) end;
  v_due   := case when p_clear_due_date then null
                  else coalesce(p_due_date, v_project.due_date) end;

  if char_length(v_name) > 120 then
    raise exception 'Keep the name under 120 characters' using errcode = 'check_violation';
  end if;
  if v_start is not null and v_due is not null and v_due < v_start then
    raise exception 'A project cannot be due before it starts' using errcode = 'check_violation';
  end if;

  update public.projects
  set name        = v_name,
      description = case when p_description is null then description
                         else nullif(btrim(p_description), '') end,
      start_date  = v_start,
      due_date    = v_due
  where id = p_project_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.updated', 'project', p_project_id::text,
    format('Project %s updated', v_name),
    jsonb_build_object('name', v_name, 'start_date', v_start, 'due_date', v_due)
  );
end;
$fn$;

comment on function public.update_project is
  'Partial update of a project''s name, description and dates: a null argument leaves the column alone. Requires projects.manage. The lifecycle stage is not editable here — transition_project owns it.';

revoke execute on function public.update_project(uuid, text, text, date, date, boolean, boolean)
  from public, anon;
grant execute on function public.update_project(uuid, text, text, date, date, boolean, boolean)
  to authenticated;

-- --- How many review durations there are -----------------------------------
--
-- A short list rather than any number of minutes. Somebody typing 7 into a
-- box means "a week" and gets seven minutes; the options people actually pick
-- are hours, and an open field would be a way to write an unreadable deadline
-- rather than a feature. Null is "no limit", which is a real answer here.

create or replace function public.assert_valid_review_duration(p_minutes integer)
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_minutes is null then return; end if;
  if p_minutes not in (60, 240, 720, 1440, 2880, 4320) then
    raise exception 'A review runs for 1, 4, 12, 24, 48 or 72 hours, or has no limit'
      using errcode = 'check_violation';
  end if;
end;
$fn$;

grant execute on function public.assert_valid_review_duration(integer) to authenticated;

-- --- The transition --------------------------------------------------------
--
-- One routine for every move a project makes, because the rule being enforced
-- is about the pair of stages and nothing else can see both. Four moves exist:
--
--   planned     → in_progress    starting
--   in_progress → in_review      sending to review
--   in_review   → in_progress    asking for changes
--   in_review   → done           completing
--
-- Everything else is refused by name — including planned → done, which is the
-- jump that made the old status a label. Done is terminal: reopening finished
-- work is not one of the four, and inventing it here rather than designing it
-- would be the same mistake in the other direction.

create or replace function public.transition_project(
  p_project_id uuid,
  p_target text,
  p_review_duration_minutes integer default null,
  -- Completing with work still open is allowed, but only when the caller says
  -- so. A call that has not looked is refused and told what it missed.
  p_allow_unfinished boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project    public.projects;
  v_target     text := lower(coalesce(nullif(btrim(p_target), ''), ''));
  v_open       integer;
  v_action     text;
  v_summary    text;
  v_metadata   jsonb;
begin
  select * into v_project from public.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'Project not found' using errcode = 'no_data_found';
  end if;

  -- Absent and forbidden look the same to somebody in another organization.
  if not public.has_org_permission(v_project.organization_id, 'projects.manage') then
    raise exception 'You do not have permission to move this project along'
      using errcode = 'insufficient_privilege';
  end if;

  if v_project.archived_at is not null then
    raise exception 'That project is archived' using errcode = 'check_violation';
  end if;

  perform public.assert_valid_project_status(v_target);

  if v_target = v_project.status then
    raise exception 'That project is already there' using errcode = 'check_violation';
  end if;

  -- --- planned → in_progress ---------------------------------------------
  if v_project.status = 'planned' and v_target = 'in_progress' then
    update public.projects set status = 'in_progress' where id = p_project_id;
    v_action  := 'project.started';
    v_summary := format('Project %s started', v_project.name);
    v_metadata := jsonb_build_object('name', v_project.name);

  -- --- in_progress → in_review -------------------------------------------
  elsif v_project.status = 'in_progress' and v_target = 'in_review' then
    perform public.assert_valid_review_duration(p_review_duration_minutes);

    update public.projects
    set status                  = 'in_review',
        review_started_at       = now(),
        review_duration_minutes = p_review_duration_minutes,
        -- Made here, from the server's clock. A deadline that arrived as an
        -- argument would be a deadline the person racing it could choose.
        review_deadline_at      = case
                                    when p_review_duration_minutes is null then null
                                    else now() + make_interval(mins => p_review_duration_minutes)
                                  end,
        review_round            = review_round + 1
    where id = p_project_id;

    v_action  := 'project.review_started';
    v_summary := format('Project %s sent to review', v_project.name);
    v_metadata := jsonb_build_object(
      'name', v_project.name,
      'review_round', v_project.review_round + 1,
      'review_duration_minutes', p_review_duration_minutes);

  -- --- in_review → in_progress -------------------------------------------
  elsif v_project.status = 'in_review' and v_target = 'in_progress' then
    -- The round number stays. It is what the review comments already written
    -- are stamped with, and the next round has to be a different number for
    -- that history to stay readable.
    update public.projects
    set status                  = 'in_progress',
        review_started_at       = null,
        review_deadline_at      = null,
        review_duration_minutes = null
    where id = p_project_id;

    v_action  := 'project.review_changes_requested';
    v_summary := format('Changes requested on %s', v_project.name);
    v_metadata := jsonb_build_object('name', v_project.name,
                                     'review_round', v_project.review_round);

  -- --- in_review → done ---------------------------------------------------
  elsif v_project.status = 'in_review' and v_target = 'done' then
    -- Read from the row, not from whatever a countdown on a screen believed.
    -- A review with no limit has no deadline and so nothing to wait for.
    if v_project.review_deadline_at is not null and now() < v_project.review_deadline_at then
      raise exception 'The review period has not ended yet'
        using errcode = 'check_violation';
    end if;

    select count(*) into v_open
    from public.tasks t
    where t.project_id = p_project_id and t.status <> 'done';

    if v_open > 0 and not coalesce(p_allow_unfinished, false) then
      raise exception '% task(s) are not complete', v_open
        using errcode = 'check_violation';
    end if;

    -- `review_started_at` and the deadline stay: they are when this project
    -- was reviewed, which is worth more after completion than before.
    update public.projects set status = 'done' where id = p_project_id;

    v_action  := 'project.completed';
    v_summary := format('Project %s completed', v_project.name);
    v_metadata := jsonb_build_object('name', v_project.name,
                                     'review_round', v_project.review_round,
                                     'unfinished_tasks', v_open);

  else
    raise exception 'A project cannot go from % to %', v_project.status, v_target
      using errcode = 'check_violation';
  end if;

  perform public.log_audit_event(
    v_project.organization_id, v_action, 'project', p_project_id::text, v_summary, v_metadata);
end;
$fn$;

comment on function public.transition_project is
  'The only way a project changes lifecycle stage. Requires projects.manage, refuses archived projects, allows only the four defined moves, computes review deadlines from the server clock, and refuses completion before the deadline or with unfinished work unless the caller says so explicitly.';

revoke execute on function public.transition_project(uuid, text, integer, boolean) from public, anon;
grant execute on function public.transition_project(uuid, text, integer, boolean) to authenticated;

-- --- Putting away, and taking back out -------------------------------------

create or replace function public.archive_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project public.projects;
begin
  select * into v_project from public.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'Project not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_project.organization_id, 'projects.delete') then
    raise exception 'You do not have permission to archive this project'
      using errcode = 'insufficient_privilege';
  end if;

  if v_project.archived_at is not null then
    raise exception 'That project is already archived' using errcode = 'check_violation';
  end if;

  -- The stage is left exactly where it was. That is the whole point of the
  -- column: a project put away half-way through review comes back half-way
  -- through review, rather than at whichever stage a migration guessed.
  update public.projects set archived_at = now() where id = p_project_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.archived', 'project', p_project_id::text,
    format('Project %s archived', v_project.name),
    jsonb_build_object('name', v_project.name, 'stage', v_project.status)
  );
end;
$fn$;

comment on function public.archive_project is
  'Puts a project away without changing where it had got to. Requires projects.delete.';

revoke execute on function public.archive_project(uuid) from public, anon;
grant execute on function public.archive_project(uuid) to authenticated;

create or replace function public.restore_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project public.projects;
begin
  select * into v_project from public.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'Project not found' using errcode = 'no_data_found';
  end if;

  -- `projects.manage`, not `projects.delete`, following 6.1's reasoning:
  -- bringing something back is not the destructive direction.
  if not public.has_org_permission(v_project.organization_id, 'projects.manage') then
    raise exception 'You do not have permission to restore this project'
      using errcode = 'insufficient_privilege';
  end if;

  if v_project.archived_at is null then
    raise exception 'That project is not archived' using errcode = 'check_violation';
  end if;

  update public.projects set archived_at = null where id = p_project_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.restored', 'project', p_project_id::text,
    format('Project %s restored', v_project.name),
    jsonb_build_object('name', v_project.name, 'stage', v_project.status)
  );
end;
$fn$;

comment on function public.restore_project is
  'Takes a project back out of the archive at the stage it was put away. Requires projects.manage.';

revoke execute on function public.restore_project(uuid) from public, anon;
grant execute on function public.restore_project(uuid) to authenticated;

-- --- Deleting, for real ----------------------------------------------------
--
-- 6.1 said a cascade is not an undo, and that is still true — which is why
-- this is a separate, confirmed action rather than what archiving does.
--
-- The child tables are not enumerated here. Every one of them already
-- references `projects` with `on delete cascade`, declared where the table is,
-- and a routine that repeated the list would be a second copy to keep in step
-- with the schema. What it does do is write the record first: `audit_log`
-- holds an entity id as text and has no foreign key to what it describes, so
-- the entry outlives the row in the same transaction that removes it.

create or replace function public.delete_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project public.projects;
  v_tasks   integer;
begin
  select * into v_project from public.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'Project not found' using errcode = 'no_data_found';
  end if;

  -- The catalogue's own words for projects.delete: "Archive or delete a
  -- project." Cross-organization deletion is refused by the same check that
  -- refuses everything else: has_org_permission is false there.
  if not public.has_org_permission(v_project.organization_id, 'projects.delete') then
    raise exception 'You do not have permission to delete this project'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_tasks from public.tasks where project_id = p_project_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.deleted', 'project', p_project_id::text,
    format('Project %s deleted', v_project.name),
    jsonb_build_object('name', v_project.name, 'stage', v_project.status,
                       'archived', v_project.archived_at is not null,
                       'tasks', v_tasks)
  );

  delete from public.projects where id = p_project_id;
end;
$fn$;

comment on function public.delete_project is
  'Permanently removes a project and everything that cascades from it. Requires projects.delete. The audit entry is written first, in the same transaction, so the record survives the row.';

revoke execute on function public.delete_project(uuid) from public, anon;
grant execute on function public.delete_project(uuid) to authenticated;

-- --- Talking about the project itself --------------------------------------
--
-- Not `task_comments`. That table answers "what did people say about this
-- task?", and its every row names a task; a review is about the project as a
-- whole, and hanging it off an arbitrary task would make the question
-- unanswerable in both directions. Same privacy model, though, exactly: the
-- words of a deleted comment move to a column no client is granted.

create table if not exists public.project_review_comments (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete set null,

  body         text not null,
  -- Where the words go when a comment is deleted. Never granted to a client.
  deleted_body text,

  -- Which round of review this was said in. Stamped once, at writing, so that
  -- asking for changes and reviewing again leaves a history somebody can read
  -- rather than one long undifferentiated thread.
  review_round integer not null default 0,

  deleted_at   timestamptz,
  deleted_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint project_review_comments_body_length check (
    (deleted_at is null and char_length(btrim(body)) between 1 and 4000)
    or (deleted_at is not null and body = '')),
  constraint project_review_comments_deletion_consistent check (
    (deleted_at is null and deleted_by is null and deleted_body is null)
    or deleted_at is not null)
);

comment on table public.project_review_comments is
  'The review conversation about a project as a whole. Soft-deleted: the row and the record stay, the words move to a column no client may select.';

create index if not exists project_review_comments_project_created_idx
  on public.project_review_comments (project_id, created_at, id);

drop trigger if exists project_review_comments_set_updated_at on public.project_review_comments;
create trigger project_review_comments_set_updated_at
  before update on public.project_review_comments
  for each row execute function public.tg_set_updated_at();

-- --- Who may read it -------------------------------------------------------

create or replace function public.can_view_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_org_permission(public.project_organization(p_project_id), 'projects.view');
$fn$;

comment on function public.can_view_project is
  'Whether the caller may see a project at all. SECURITY DEFINER so a policy can ask without recursing through the projects policy.';

revoke execute on function public.can_view_project(uuid) from public, anon;
grant execute on function public.can_view_project(uuid) to authenticated;

alter table public.project_review_comments enable row level security;

drop policy if exists "Members can read the review of a project they may view"
  on public.project_review_comments;
create policy "Members can read the review of a project they may view"
  on public.project_review_comments for select to authenticated
  using (public.can_view_project(project_id));

-- Both roles, and `authenticated` especially: this project's default
-- privileges already hand it SELECT on a new table in `public`, and a column
-- grant only ever adds. Without taking the table-wide privilege away first,
-- `deleted_body` would be readable by anybody who asked for it by name.
revoke all on public.project_review_comments from anon, authenticated;
grant select (id, project_id, author_id, body, review_round,
              deleted_at, deleted_by, created_at, updated_at)
  on public.project_review_comments to authenticated;

-- --- Writing, changing and taking back a review comment --------------------
--
-- Reading and writing both ask for `projects.view` — the same thing seeing
-- the project asks for — because a review everybody can read but only a
-- manager may answer is not a review. Changing somebody else's words needs
-- `projects.manage`, which is the same shape 6.3 used for tasks.

create or replace function public.create_project_review_comment(
  p_project_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project public.projects;
  v_body    text := btrim(coalesce(p_body, ''));
  v_id      uuid;
  v_actor   uuid := (select auth.uid());
begin
  select * into v_project from public.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'Project not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_project.organization_id, 'projects.view') then
    raise exception 'You do not have permission to comment on this project'
      using errcode = 'insufficient_privilege';
  end if;

  if v_project.archived_at is not null then
    raise exception 'That project is archived' using errcode = 'check_violation';
  end if;

  if v_body = '' then
    raise exception 'A comment needs something in it' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'Keep a comment under 4000 characters' using errcode = 'check_violation';
  end if;

  insert into public.project_review_comments (project_id, author_id, body, review_round)
  values (p_project_id, v_actor, v_body, v_project.review_round)
  returning id into v_id;

  -- The body is deliberately not in the metadata. An audit entry records that
  -- something was said, not what.
  perform public.log_audit_event(
    v_project.organization_id, 'project.review_comment_added', 'project', p_project_id::text,
    format('Review comment on %s', v_project.name),
    jsonb_build_object('comment_id', v_id, 'review_round', v_project.review_round)
  );
  return v_id;
end;
$fn$;

revoke execute on function public.create_project_review_comment(uuid, text) from public, anon;
grant execute on function public.create_project_review_comment(uuid, text) to authenticated;

create or replace function public.update_project_review_comment(
  p_comment_id uuid,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_comment public.project_review_comments;
  v_project public.projects;
  v_body    text := btrim(coalesce(p_body, ''));
  v_actor   uuid := (select auth.uid());
begin
  select * into v_comment from public.project_review_comments where id = p_comment_id;
  if v_comment.id is null then
    raise exception 'Comment not found' using errcode = 'no_data_found';
  end if;
  if v_comment.deleted_at is not null then
    raise exception 'That comment has been deleted' using errcode = 'check_violation';
  end if;

  select * into v_project from public.projects where id = v_comment.project_id;

  if not public.has_org_permission(v_project.organization_id, 'projects.view') then
    raise exception 'You do not have permission to change this comment'
      using errcode = 'insufficient_privilege';
  end if;
  if v_project.archived_at is not null then
    raise exception 'That project is archived' using errcode = 'check_violation';
  end if;

  if v_comment.author_id is distinct from v_actor
     and not public.has_org_permission(v_project.organization_id, 'projects.manage') then
    raise exception 'You can only edit your own comments' using errcode = 'insufficient_privilege';
  end if;

  if v_body = '' then
    raise exception 'A comment needs something in it' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'Keep a comment under 4000 characters' using errcode = 'check_violation';
  end if;

  update public.project_review_comments set body = v_body where id = p_comment_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.review_comment_updated', 'project',
    v_comment.project_id::text,
    format('Review comment on %s edited', v_project.name),
    jsonb_build_object('comment_id', p_comment_id)
  );
end;
$fn$;

revoke execute on function public.update_project_review_comment(uuid, text) from public, anon;
grant execute on function public.update_project_review_comment(uuid, text) to authenticated;

create or replace function public.delete_project_review_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_comment public.project_review_comments;
  v_project public.projects;
  v_actor   uuid := (select auth.uid());
begin
  select * into v_comment from public.project_review_comments where id = p_comment_id;
  if v_comment.id is null then
    raise exception 'Comment not found' using errcode = 'no_data_found';
  end if;
  if v_comment.deleted_at is not null then
    raise exception 'That comment has already been deleted' using errcode = 'check_violation';
  end if;

  select * into v_project from public.projects where id = v_comment.project_id;

  if not public.has_org_permission(v_project.organization_id, 'projects.view') then
    raise exception 'You do not have permission to delete this comment'
      using errcode = 'insufficient_privilege';
  end if;
  if v_project.archived_at is not null then
    raise exception 'That project is archived' using errcode = 'check_violation';
  end if;

  if v_comment.author_id is distinct from v_actor
     and not public.has_org_permission(v_project.organization_id, 'projects.manage') then
    raise exception 'You can only delete your own comments'
      using errcode = 'insufficient_privilege';
  end if;

  -- The row stays, the round it belonged to stays, and the words move
  -- somewhere no client has the privilege to select. Asking for changes never
  -- removes any of this: review history is the point of keeping it.
  update public.project_review_comments
  set deleted_body = v_comment.body,
      body         = '',
      deleted_at   = now(),
      deleted_by   = v_actor
  where id = p_comment_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.review_comment_deleted', 'project',
    v_comment.project_id::text,
    format('Review comment on %s deleted', v_project.name),
    jsonb_build_object('comment_id', p_comment_id, 'author_id', v_comment.author_id)
  );
end;
$fn$;

comment on function public.delete_project_review_comment is
  'Soft-deletes a review comment: the row, the round and the audit entry stay, and the words move to deleted_body, which no client may select.';

revoke execute on function public.delete_project_review_comment(uuid) from public, anon;
grant execute on function public.delete_project_review_comment(uuid) to authenticated;

-- --- What the list needs to draw a row -------------------------------------
--
-- Who is working on a project is derived, not stored. A second "worker"
-- relationship would be a thing to keep in step with assignment, and it would
-- be wrong the moment somebody reassigned a task; asking the tasks is always
-- right. "Working on it" therefore means: has at least one task here that is
-- not done. Somebody whose tasks are all finished is still a member and is no
-- longer in the list, which is the honest reading of the question.
--
-- Nothing about presence, last seen, or being online. The list says who the
-- work is on, which is a fact about the board rather than about a person.
--
-- One round trip for the whole list, because the alternative is either a
-- query per project or shipping every task in the organization to draw a row
-- of avatars.

create or replace function public.project_overview(p_organization_id uuid)
returns table (
  project_id   uuid,
  total_tasks  integer,
  done_tasks   integer,
  workers      jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_sees_tasks boolean;
begin
  if not public.has_org_permission(p_organization_id, 'projects.view') then
    raise exception 'You do not have permission to view projects'
      using errcode = 'insufficient_privilege';
  end if;

  -- Seeing projects and seeing the work on them are separate permissions, and
  -- somebody holding only the first gets a list without counts rather than an
  -- error — the row is still worth drawing.
  v_sees_tasks := public.has_org_permission(p_organization_id, 'tasks.view');

  return query
  select
    p.id,
    coalesce(counted.total, 0)::integer,
    coalesce(counted.done, 0)::integer,
    coalesce(assigned.workers, '[]'::jsonb)
  from public.projects p
  left join lateral (
    select count(*)::integer as total,
           count(*) filter (where t.status = 'done')::integer as done
    from public.tasks t
    where v_sees_tasks and t.project_id = p.id
  ) counted on true
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'member_id', one.member_id,
               'user_id', one.user_id,
               'display_name', one.display_name,
               'full_name', one.full_name,
               'email', one.email,
               'avatar_url', one.avatar_url,
               'open_tasks', one.open_tasks)
             order by one.open_tasks desc, one.sort_name) as workers
    from (
      select m.id as member_id, pr.id as user_id,
             pr.display_name, pr.full_name, pr.email, pr.avatar_url,
             count(*)::integer as open_tasks,
             lower(coalesce(pr.display_name, pr.full_name, pr.email)) as sort_name
      from public.tasks t
      join public.organization_members m on m.id = t.assignee_id
      join public.profiles pr on pr.id = m.user_id
      where v_sees_tasks
        and t.project_id = p.id
        and t.assignee_id is not null
        and t.status <> 'done'
      group by m.id, pr.id, pr.display_name, pr.full_name, pr.email, pr.avatar_url
    ) one
  ) assigned on true
  where p.organization_id = p_organization_id;
end;
$fn$;

comment on function public.project_overview is
  'Per project: how many tasks there are, how many are done, and who currently has unfinished work on it. Derived from assignment, never stored. Requires projects.view; counts are empty without tasks.view.';

revoke execute on function public.project_overview(uuid) from public, anon;
grant execute on function public.project_overview(uuid) to authenticated;

-- --- Realtime --------------------------------------------------------------
--
-- One more table on the publication the six joined in 6.4, on the same terms:
-- delivery scoped per subscriber by the policy above, replica identity left
-- at default so a deletion says only which row went, and `deleted_body`
-- outside the column grant so it cannot travel however the payload is shaped.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'project_review_comments'
  ) then
    alter publication supabase_realtime add table public.project_review_comments;
  end if;
end $$;
