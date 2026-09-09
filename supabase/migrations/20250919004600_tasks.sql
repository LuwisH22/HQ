-- ===========================================================================
-- LFG HQ · Phase 6.2 · Tasks and the board
--
-- One table and five routines. No labels, no comments, no realtime: those are
-- the phases after this one.
--
-- Five decisions, because everything else follows from them.
--
-- 1 · No new permission.
--    `tasks.view`, `tasks.create`, `tasks.assign` and `tasks.manage` have been
--    in the catalogue since 20250901000200. There is no `tasks.delete`, and
--    none is added: the catalogue's own words for `tasks.manage` are "Edit or
--    delete any task on a visible project", so that is the permission deleting
--    one asks for.
--
-- 2 · A task's organization is its project's.
--    Nothing here takes an organization from a caller. Every check resolves it
--    through the project, so a task in another organization is not something
--    to refuse — it is something that cannot be described.
--
-- 3 · An assignee is a membership, and one that is on the project.
--    `assignee_id` references `organization_members`, as `project_members`
--    does, so "same organization" is true by construction. A trigger adds the
--    roster check, and taking somebody off a project clears their assignments
--    rather than deleting their work.
--
-- 4 · Position is the server's to decide.
--    The client says which two tasks to go between; the routine works out the
--    number. A client that sent its own position could reorder a board it may
--    not touch, and two clients dragging at once could agree on a number that
--    means different things.
--
-- 5 · `completed_at` is not the client's either.
--    It is set when a task enters Done and cleared when it leaves, in the same
--    statement that moves it, so the two can never disagree.
--
-- Writes go through SECURITY DEFINER routines, as every protected write in
-- this schema does. There is no client write policy on the table.
--
-- Additive only.
-- ===========================================================================

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,

  title        text not null,
  description  text,

  status       text not null default 'todo',
  priority     text not null default 'none',

  -- A membership, not a person: the same reasoning as project_members, and it
  -- makes an assignee from another organization impossible rather than
  -- unlikely. Null when nobody has it.
  assignee_id  uuid references public.organization_members (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null,

  -- A day, like a project's dates. A task is due on a date somebody names, not
  -- at an instant in a particular zone.
  due_date     date,

  -- Sparse and fractional, so putting a task between two others is one write
  -- rather than a renumbering of the column. `numeric` rather than a float
  -- because halving a gap must not run out of precision quietly.
  position     numeric not null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Set by the routines when a task enters Done, cleared when it leaves.
  completed_at timestamptz,

  constraint tasks_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint tasks_description_length check (
    description is null or char_length(description) <= 4000),
  constraint tasks_status_valid check (
    status in ('backlog', 'todo', 'in_progress', 'review', 'done')),
  constraint tasks_priority_valid check (
    priority in ('none', 'low', 'medium', 'high', 'urgent')),
  -- The two can never drift apart: Done has a completion, and nothing else
  -- keeps one.
  constraint tasks_completion_consistent check (
    (status = 'done' and completed_at is not null)
    or (status <> 'done' and completed_at is null))
);

comment on table public.tasks is
  'Work on a project. Read by members holding tasks.view on a project they may see; written only by the SECURITY DEFINER routines below.';

-- The board's own query: one project, one column, in order.
create index tasks_project_status_position_idx
  on public.tasks (project_id, status, position);
-- "What is on me?", for a later phase.
create index tasks_assignee_idx on public.tasks (assignee_id) where assignee_id is not null;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.tg_set_updated_at();

-- --- A task cannot change projects, and its people belong to it ------------

create or replace function public.tg_task_relations()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_org uuid;
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'A task cannot be moved to another project'
      using errcode = 'check_violation';
  end if;

  v_org := public.project_organization(new.project_id);
  if v_org is null then
    raise exception 'That project does not exist' using errcode = 'foreign_key_violation';
  end if;

  -- The assignee is a membership, so this is the only question left to ask:
  -- is it a membership of this project's own organization, and is it on the
  -- project's roster?
  if new.assignee_id is not null then
    if not exists (
      select 1 from public.organization_members m
      where m.id = new.assignee_id and m.organization_id = v_org
    ) then
      raise exception 'An assignee has to belong to the project''s organization'
        using errcode = 'foreign_key_violation';
    end if;

    if not exists (
      select 1 from public.project_members pm
      where pm.project_id = new.project_id and pm.member_id = new.assignee_id
    ) then
      raise exception 'An assignee has to be on the project' using errcode = 'check_violation';
    end if;
  end if;

  if new.created_by is not null
     and not exists (
       select 1 from public.organization_members m
       where m.user_id = new.created_by and m.organization_id = v_org
     ) then
    raise exception 'A task''s author has to be a member of its organization'
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$fn$;

create trigger tasks_relations
  before insert or update on public.tasks
  for each row execute function public.tg_task_relations();

-- --- Leaving a project puts your work down, it does not delete it ----------

create or replace function public.tg_project_member_unassign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.tasks
  set assignee_id = null
  where project_id = old.project_id and assignee_id = old.member_id;
  return old;
end;
$fn$;

comment on function public.tg_project_member_unassign is
  'Clears the assignee on a project''s tasks when that member comes off it. The task stays; only the name does not.';

create trigger project_members_unassign
  after delete on public.project_members
  for each row execute function public.tg_project_member_unassign();

-- --- RLS -------------------------------------------------------------------
-- A task is visible to somebody who may see tasks and may see the project it
-- is on. Both are organization permissions; project membership grants nothing.

alter table public.tasks enable row level security;

create policy "Members can read tasks on projects they may view"
  on public.tasks for select to authenticated
  using (
    public.has_org_permission(public.project_organization(project_id), 'tasks.view')
    and public.has_org_permission(public.project_organization(project_id), 'projects.view')
  );

revoke all on public.tasks from anon;
grant select on public.tasks to authenticated;

-- --- The one gate every write goes through ---------------------------------

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

  -- Absent and forbidden look the same to somebody in another organization:
  -- has_org_permission is false for both.
  if not public.has_org_permission(p_project.organization_id, p_permission) then
    raise exception 'You do not have permission to % on this project', p_what
      using errcode = 'insufficient_privilege';
  end if;

  -- An archived project keeps everything it has and takes nothing new. Bring
  -- it back and every one of these routines works again, with no other change.
  if p_project.status = 'archived' then
    raise exception 'That project is archived' using errcode = 'check_violation';
  end if;
end;
$fn$;

comment on function public.assert_may_write_task is
  'The single gate on every task write: the project exists, the caller holds the permission in its organization, and the project is not archived.';

-- --- Where a task goes -----------------------------------------------------
--
-- The client says which two tasks to land between and the server works out the
-- number, so a client cannot invent an order, and two clients dragging at once
-- cannot agree on a number that means different things.
--
-- Named neighbours that do not belong to this column are ignored rather than
-- refused: a board that was a second out of date should place the task
-- somewhere sensible, not throw.

create or replace function public.task_position_between(
  p_project_id uuid,
  p_status text,
  p_before_id uuid,
  p_after_id uuid,
  p_moving_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_prev numeric;
  v_next numeric;
  v_row  record;
  v_next_position numeric := 1000;
begin
  select t.position into v_prev
  from public.tasks t
  where t.id = p_before_id and t.project_id = p_project_id and t.status = p_status
    and t.id is distinct from p_moving_id;

  select t.position into v_next
  from public.tasks t
  where t.id = p_after_id and t.project_id = p_project_id and t.status = p_status
    and t.id is distinct from p_moving_id;

  -- Only one neighbour named, or one of them stale: find the other from the
  -- column itself, so the task lands beside what it was told about.
  if v_prev is not null and v_next is null then
    select min(t.position) into v_next
    from public.tasks t
    where t.project_id = p_project_id and t.status = p_status
      and t.position > v_prev and t.id is distinct from p_moving_id;
  elsif v_next is not null and v_prev is null then
    select max(t.position) into v_prev
    from public.tasks t
    where t.project_id = p_project_id and t.status = p_status
      and t.position < v_next and t.id is distinct from p_moving_id;
  elsif v_prev is null and v_next is null then
    -- Nothing named: the end of the column, which is where a new task goes.
    select max(t.position) into v_prev
    from public.tasks t
    where t.project_id = p_project_id and t.status = p_status
      and t.id is distinct from p_moving_id;
  end if;

  -- A gap this small means the column has been halved into a corner. Renumber
  -- it — every task keeps its order, and the numbers become short again — then
  -- read the neighbours back at their new positions.
  if v_prev is not null and v_next is not null and (v_next - v_prev) < 0.000001 then
    for v_row in
      select t.id from public.tasks t
      where t.project_id = p_project_id and t.status = p_status
        and t.id is distinct from p_moving_id
      order by t.position, t.created_at, t.id
    loop
      update public.tasks set position = v_next_position where id = v_row.id;
      v_next_position := v_next_position + 1000;
    end loop;

    select t.position into v_prev from public.tasks t where t.id = p_before_id;
    select t.position into v_next from public.tasks t where t.id = p_after_id;
  end if;

  if v_prev is null and v_next is null then return 1000; end if;
  if v_prev is null then return v_next - 1000; end if;
  if v_next is null then return v_prev + 1000; end if;
  return (v_prev + v_next) / 2;
end;
$fn$;

comment on function public.task_position_between is
  'The position a task should take between two named neighbours, rebalancing the column first if the gap has closed. Never called by a client directly.';

revoke execute on function public.task_position_between(uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;

-- --- Creating --------------------------------------------------------------

create or replace function public.create_task(
  p_project_id uuid,
  p_title text,
  p_description text default null,
  p_status text default 'todo',
  p_priority text default 'none',
  p_assignee_id uuid default null,
  p_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project  public.projects;
  v_title    text := btrim(coalesce(p_title, ''));
  v_status   text := lower(coalesce(nullif(btrim(p_status), ''), 'todo'));
  v_priority text := lower(coalesce(nullif(btrim(p_priority), ''), 'none'));
  v_id       uuid;
begin
  select * into v_project from public.projects where id = p_project_id;
  perform public.assert_may_write_task(v_project, 'tasks.create', 'create tasks');

  if v_title = '' then
    raise exception 'A task needs a title' using errcode = 'check_violation';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'Keep the title under 200 characters' using errcode = 'check_violation';
  end if;
  if v_status not in ('backlog', 'todo', 'in_progress', 'review', 'done') then
    raise exception 'Unknown task status: %', v_status using errcode = 'check_violation';
  end if;
  if v_priority not in ('none', 'low', 'medium', 'high', 'urgent') then
    raise exception 'Unknown task priority: %', v_priority using errcode = 'check_violation';
  end if;

  -- Giving somebody a task is giving somebody a task, whichever routine it
  -- happens in.
  if p_assignee_id is not null
     and not public.has_org_permission(v_project.organization_id, 'tasks.assign') then
    raise exception 'You do not have permission to assign tasks on this project'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.tasks
    (project_id, title, description, status, priority, assignee_id, created_by, due_date,
     position, completed_at)
  values
    (p_project_id, v_title,
     nullif(btrim(coalesce(p_description, '')), ''),
     v_status, v_priority, p_assignee_id, (select auth.uid()), p_due_date,
     public.task_position_between(p_project_id, v_status, null, null, null),
     case when v_status = 'done' then now() else null end)
  returning id into v_id;

  perform public.log_audit_event(
    v_project.organization_id, 'task.created', 'task', v_id::text,
    format('Task %s added to %s', v_title, v_project.name),
    jsonb_build_object('project_id', p_project_id, 'title', v_title,
                       'status', v_status, 'priority', v_priority)
  );
  return v_id;
end;
$fn$;

comment on function public.create_task is
  'Adds a task to the end of its column. Requires tasks.create, and tasks.assign as well if it arrives with somebody on it.';

revoke execute on function public.create_task(uuid, text, text, text, text, uuid, date)
  from public, anon;
grant execute on function public.create_task(uuid, text, text, text, text, uuid, date)
  to authenticated;

-- --- Editing ---------------------------------------------------------------
--
-- Properties only. Status and position belong to `move_task`, so a task's
-- column and its place in that column can never be set independently and drift
-- out of step.

create or replace function public.update_task(
  p_task_id uuid,
  p_title text default null,
  p_description text default null,
  p_priority text default null,
  p_due_date date default null,
  p_clear_due_date boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_task     public.tasks;
  v_project  public.projects;
  v_title    text;
  v_priority text;
  v_due      date;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;

  select * into v_project from public.projects where id = v_task.project_id;
  perform public.assert_may_write_task(v_project, 'tasks.manage', 'change tasks');

  v_title    := coalesce(nullif(btrim(coalesce(p_title, '')), ''), v_task.title);
  v_priority := lower(coalesce(nullif(btrim(coalesce(p_priority, '')), ''), v_task.priority));
  v_due      := case when p_clear_due_date then null
                     else coalesce(p_due_date, v_task.due_date) end;

  if char_length(v_title) > 200 then
    raise exception 'Keep the title under 200 characters' using errcode = 'check_violation';
  end if;
  if v_priority not in ('none', 'low', 'medium', 'high', 'urgent') then
    raise exception 'Unknown task priority: %', v_priority using errcode = 'check_violation';
  end if;

  update public.tasks
  set title       = v_title,
      description = case when p_description is null then description
                         else nullif(btrim(p_description), '') end,
      priority    = v_priority,
      due_date    = v_due
  where id = p_task_id;

  perform public.log_audit_event(
    v_project.organization_id, 'task.updated', 'task', p_task_id::text,
    format('Task %s updated', v_title),
    jsonb_build_object('project_id', v_task.project_id, 'title', v_title,
                       'priority', v_priority, 'due_date', v_due)
  );
end;
$fn$;

comment on function public.update_task is
  'Partial update of a task''s properties: a null argument leaves the column alone. Requires tasks.manage. Status and position belong to move_task.';

revoke execute on function public.update_task(uuid, text, text, text, date, boolean)
  from public, anon;
grant execute on function public.update_task(uuid, text, text, text, date, boolean)
  to authenticated;

-- --- Moving ----------------------------------------------------------------
--
-- One routine for a drag: the column, the place in it, and whether the task is
-- finished, all decided together. A reorder inside one column writes no audit
-- entry — dragging something up two places is not an event anybody needs a
-- record of — but crossing into another column is, and that entry carries both
-- ends of the move.

create or replace function public.move_task(
  p_task_id uuid,
  p_status text default null,
  p_before_id uuid default null,
  p_after_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_task    public.tasks;
  v_project public.projects;
  v_status  text;
  v_position numeric;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;

  select * into v_project from public.projects where id = v_task.project_id;
  perform public.assert_may_write_task(v_project, 'tasks.manage', 'move tasks');

  v_status := lower(coalesce(nullif(btrim(coalesce(p_status, '')), ''), v_task.status));
  if v_status not in ('backlog', 'todo', 'in_progress', 'review', 'done') then
    raise exception 'Unknown task status: %', v_status using errcode = 'check_violation';
  end if;

  v_position := public.task_position_between(
    v_task.project_id, v_status, p_before_id, p_after_id, p_task_id);

  update public.tasks
  set status       = v_status,
      position     = v_position,
      -- Never the client's to send: entering Done stamps it, leaving clears
      -- it, and the CHECK constraint refuses any other combination.
      completed_at = case
                       when v_status = 'done' and v_task.status = 'done' then completed_at
                       when v_status = 'done' then now()
                       else null
                     end
  where id = p_task_id;

  if v_status is distinct from v_task.status then
    perform public.log_audit_event(
      v_project.organization_id, 'task.status_changed', 'task', p_task_id::text,
      format('Task %s moved to %s', v_task.title, replace(v_status, '_', ' ')),
      jsonb_build_object('project_id', v_task.project_id, 'title', v_task.title,
                         'from', v_task.status, 'to', v_status)
    );
  end if;
end;
$fn$;

comment on function public.move_task is
  'Moves a task within or between columns. The caller names its neighbours; the routine works out the position, keeps completed_at in step, and audits only a change of column.';

revoke execute on function public.move_task(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.move_task(uuid, text, uuid, uuid) to authenticated;

-- --- Assigning -------------------------------------------------------------
-- Its own routine because it is its own permission: somebody may be trusted to
-- move work about without being trusted to put it on other people.

create or replace function public.assign_task(
  p_task_id uuid,
  p_assignee_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_task    public.tasks;
  v_project public.projects;
  v_member  public.organization_members;
  v_name    text;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;

  select * into v_project from public.projects where id = v_task.project_id;
  perform public.assert_may_write_task(v_project, 'tasks.assign', 'assign tasks');

  if p_assignee_id is not null then
    select * into v_member from public.organization_members where id = p_assignee_id;
    -- One message for "not in this organization" and for "no such membership":
    -- a caller elsewhere learns nothing either way.
    if v_member.id is null or v_member.organization_id <> v_project.organization_id then
      raise exception 'That person is not in this organization'
        using errcode = 'foreign_key_violation';
    end if;
    if not public.is_effectively_active(v_member.status, v_member.suspended_until) then
      raise exception 'That member is not active' using errcode = 'check_violation';
    end if;
    -- The roster is also checked by the table's trigger; this is the sentence.
    if not exists (
      select 1 from public.project_members pm
      where pm.project_id = v_task.project_id and pm.member_id = p_assignee_id
    ) then
      raise exception 'That member is not on this project' using errcode = 'check_violation';
    end if;
  end if;

  update public.tasks set assignee_id = p_assignee_id where id = p_task_id;

  select coalesce(pr.display_name, pr.full_name, pr.email) into v_name
  from public.organization_members m
  join public.profiles pr on pr.id = m.user_id
  where m.id = p_assignee_id;

  perform public.log_audit_event(
    v_project.organization_id, 'task.assigned', 'task', p_task_id::text,
    case when p_assignee_id is null
         then format('Task %s unassigned', v_task.title)
         else format('Task %s assigned to %s', v_task.title, coalesce(v_name, 'a member')) end,
    jsonb_build_object('project_id', v_task.project_id, 'title', v_task.title,
                       'assignee_id', p_assignee_id)
  );
end;
$fn$;

comment on function public.assign_task is
  'Puts a task on somebody who is on the project, or takes it off them with null. Requires tasks.assign.';

revoke execute on function public.assign_task(uuid, uuid) from public, anon;
grant execute on function public.assign_task(uuid, uuid) to authenticated;

-- --- Deleting --------------------------------------------------------------
--
-- Under `tasks.manage`, because the permission catalogue has said since
-- 20250901000200 that it means "Edit or delete any task on a visible project".
-- Inventing a `tasks.delete` to sit beside it would be adding an authorization
-- concept the product already has.
--
-- A hard delete, unlike a project's archive: nothing hangs off a task yet, and
-- a board that fills with crossed-out work is a board nobody reads. The audit
-- entry is what remains, and it outlives the row.

create or replace function public.delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_task    public.tasks;
  v_project public.projects;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;

  select * into v_project from public.projects where id = v_task.project_id;
  perform public.assert_may_write_task(v_project, 'tasks.manage', 'delete tasks');

  delete from public.tasks where id = p_task_id;

  perform public.log_audit_event(
    v_project.organization_id, 'task.deleted', 'task', p_task_id::text,
    format('Task %s deleted', v_task.title),
    jsonb_build_object('project_id', v_task.project_id, 'title', v_task.title,
                       'status', v_task.status)
  );
end;
$fn$;

comment on function public.delete_task is
  'Removes a task. Requires tasks.manage, which the catalogue defines as editing or deleting any task on a visible project. The audit entry outlives the row.';

revoke execute on function public.delete_task(uuid) from public, anon;
grant execute on function public.delete_task(uuid) to authenticated;

-- --- Realtime --------------------------------------------------------------
-- Deliberately not added to the publication: keeping a board current between
-- people is Phase 6.4, and a table in a publication nothing listens to is a
-- thing that looks harmless until somebody relies on it.
