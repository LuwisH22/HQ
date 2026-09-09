-- ===========================================================================
-- LFG HQ · Phase 6.3 · Labels and task comments
--
-- Three tables and eight routines. No realtime, no notifications, no search:
-- those are the phases after this one.
--
-- Five decisions, because everything else follows from them.
--
-- 1 · No new permission.
--    `tasks.view` sees labels and comments; `tasks.manage` writes labels and
--    moderates comments. A `labels.manage` would be a fourth way to say a
--    thing the product already says, and the catalogue has said since
--    20250901000200 that tasks.manage means editing anything on a visible
--    project.
--
-- 2 · A label belongs to one project, and colour is a token.
--    Not a hex string, not a class name: one of six keys this application's
--    Badge component already draws. A label cannot become styling, because
--    there is no styling in it to become.
--
-- 3 · A comment is soft-deleted, and its words really do go away.
--    `messages` blanks a deleted body in the client, which means the text
--    still crosses the wire. Here the routine moves it into `deleted_body`,
--    which `authenticated` has no column privilege to select at all. The row
--    and the record survive; the words are only reachable by somebody with
--    database access, deliberately.
--
-- 4 · A task is still hard-deleted, and everything on it goes with it.
--    6.2 chose that, and comments do not change it: the foreign keys cascade,
--    so there are no orphans, and the audit entry outlives all of it — which
--    is the same shape a deleted message's audit entry has.
--
-- 5 · An archived project takes nothing new here either.
--    Labels and comments go through the same gate every task write goes
--    through, so restoring a project brings all of it back with no other
--    change.
--
-- Additive only.
-- ===========================================================================

-- --- Labels ----------------------------------------------------------------

create table if not exists public.project_labels (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,

  name        text not null,
  description text,

  -- A token, not a colour. These six are the Badge variants this application
  -- already has, so a label can only ever be drawn the way everything else is.
  color       text not null default 'neutral',

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint project_labels_name_length check (char_length(btrim(name)) between 1 and 40),
  constraint project_labels_description_length check (
    description is null or char_length(description) <= 200),
  constraint project_labels_color_valid check (
    color in ('violet', 'brass', 'success', 'warning', 'danger', 'neutral'))
);

comment on table public.project_labels is
  'Labels, scoped to one project. Colour is one of six tokens rather than anything a client can style with.';

-- Two labels called the same thing in one project is a mistake, not a choice.
-- Case-insensitively, because "Urgent" and "urgent" are the same label.
create unique index if not exists project_labels_unique_name_idx
  on public.project_labels (project_id, lower(btrim(name)));

drop trigger if exists project_labels_set_updated_at on public.project_labels;
create trigger project_labels_set_updated_at
  before update on public.project_labels
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_project_label_project_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'A label cannot be moved to another project'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists project_labels_project_immutable on public.project_labels;
create trigger project_labels_project_immutable
  before update on public.project_labels
  for each row execute function public.tg_project_label_project_immutable();

-- --- Labels on tasks -------------------------------------------------------

create table if not exists public.task_labels (
  task_id     uuid not null references public.tasks (id) on delete cascade,
  label_id    uuid not null references public.project_labels (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),

  primary key (task_id, label_id)
);

comment on table public.task_labels is
  'Which labels are on which tasks. Both sides cascade: deleting a task takes its labels off it, deleting a label takes it off every task, and neither deletes the other thing.';

create index if not exists task_labels_label_idx on public.task_labels (label_id);

-- A label from another project — or, through it, another organization — is not
-- something to refuse in the client. It is refused here.
create or replace function public.tg_task_label_same_project()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_task_project  uuid;
  v_label_project uuid;
begin
  select project_id into v_task_project from public.tasks where id = new.task_id;
  select project_id into v_label_project from public.project_labels where id = new.label_id;

  if v_task_project is null or v_label_project is null or v_task_project <> v_label_project then
    raise exception 'That label belongs to another project' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists task_labels_same_project on public.task_labels;
create trigger task_labels_same_project
  before insert or update on public.task_labels
  for each row execute function public.tg_task_label_same_project();

-- --- Comments --------------------------------------------------------------
--
-- Soft-deleted, and the words are really gone. `deleted_body` keeps them for
-- whoever has database access; `authenticated` has no column privilege on it,
-- so an ordinary reader cannot select it however the request is written. That
-- is stronger than blanking the body in the client, which is what `messages`
-- does — there the text still crosses the wire.

create table if not exists public.task_comments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete set null,

  body         text not null,
  -- Where the words go when a comment is deleted. Never granted to a client.
  deleted_body text,

  deleted_at   timestamptz,
  deleted_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A comment that is here has something in it; a deleted one has nothing.
  constraint task_comments_body_length check (
    (deleted_at is null and char_length(btrim(body)) between 1 and 4000)
    or (deleted_at is not null and body = '')),
  constraint task_comments_deletion_consistent check (
    (deleted_at is null and deleted_by is null and deleted_body is null)
    or deleted_at is not null)
);

comment on table public.task_comments is
  'Talk about one task. Soft-deleted: the row and the record stay, the words move to a column no client may select.';

-- The order a thread reads in, and the key a page turns on.
create index if not exists task_comments_task_created_idx
  on public.task_comments (task_id, created_at, id);

drop trigger if exists task_comments_set_updated_at on public.task_comments;
create trigger task_comments_set_updated_at
  before update on public.task_comments
  for each row execute function public.tg_set_updated_at();

-- --- RLS -------------------------------------------------------------------
--
-- All three inherit task visibility, which is itself `tasks.view` and
-- `projects.view` on the project's organization. Nothing here consults project
-- membership: it is context, as it has been since 6.1.

create or replace function public.can_view_project_tasks(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_org_permission(public.project_organization(p_project_id), 'tasks.view')
     and public.has_org_permission(public.project_organization(p_project_id), 'projects.view');
$fn$;

comment on function public.can_view_project_tasks is
  'Whether the caller may see the work on a project. SECURITY DEFINER so a policy can ask without recursing through the projects policy.';

revoke execute on function public.can_view_project_tasks(uuid) from public, anon;
grant execute on function public.can_view_project_tasks(uuid) to authenticated;

/** The project a task belongs to, read past RLS for the policies below. */
create or replace function public.task_project(p_task_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select t.project_id from public.tasks t where t.id = p_task_id;
$fn$;

revoke execute on function public.task_project(uuid) from public, anon;
grant execute on function public.task_project(uuid) to authenticated;

alter table public.project_labels enable row level security;

drop policy if exists "Members can read labels on projects they may view" on public.project_labels;
create policy "Members can read labels on projects they may view"
  on public.project_labels for select to authenticated
  using (public.can_view_project_tasks(project_id));

revoke all on public.project_labels from anon;
grant select on public.project_labels to authenticated;

alter table public.task_labels enable row level security;

drop policy if exists "Members can read the labels on tasks they may see" on public.task_labels;
create policy "Members can read the labels on tasks they may see"
  on public.task_labels for select to authenticated
  using (public.can_view_project_tasks(public.task_project(task_id)));

revoke all on public.task_labels from anon;
grant select on public.task_labels to authenticated;

alter table public.task_comments enable row level security;

drop policy if exists "Members can read comments on tasks they may see" on public.task_comments;
create policy "Members can read comments on tasks they may see"
  on public.task_comments for select to authenticated
  using (public.can_view_project_tasks(public.task_project(task_id)));

-- Both roles, and `authenticated` especially: this project's default
-- privileges already hand it SELECT on a new table in `public`, and a column
-- grant only ever adds. Without taking the table-wide privilege away first,
-- the narrower grant below would be a no-op — which is exactly what the
-- verification script caught the first time this was applied.
revoke all on public.task_comments from anon, authenticated;

-- Column by column, and `deleted_body` is not among them: a deleted comment's
-- words are not something a client may ask for, however it asks.
grant select (id, task_id, author_id, body, deleted_at, deleted_by, created_at, updated_at)
  on public.task_comments to authenticated;

-- --- Labels: creating, changing, removing ----------------------------------
--
-- All three ask `tasks.manage` through the gate 6.2 already uses, so an
-- archived project refuses them and a member of another organization cannot
-- tell a refusal from an absence.

create or replace function public.create_label(
  p_project_id uuid,
  p_name text,
  p_color text default 'neutral',
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project public.projects;
  v_name    text := btrim(coalesce(p_name, ''));
  v_color   text := lower(coalesce(nullif(btrim(p_color), ''), 'neutral'));
  v_id      uuid;
begin
  select * into v_project from public.projects where id = p_project_id;
  perform public.assert_may_write_task(v_project, 'tasks.manage', 'manage labels');

  if v_name = '' then
    raise exception 'A label needs a name' using errcode = 'check_violation';
  end if;
  if char_length(v_name) > 40 then
    raise exception 'Keep the name under 40 characters' using errcode = 'check_violation';
  end if;
  if v_color not in ('violet', 'brass', 'success', 'warning', 'danger', 'neutral') then
    raise exception 'Unknown label colour: %', v_color using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.project_labels l
    where l.project_id = p_project_id and lower(btrim(l.name)) = lower(v_name)
  ) then
    -- check_violation rather than unique_violation on purpose: `errors.ts`
    -- shows the routine's own words for that code and a generic sentence for
    -- this one, and "this project already has a label called scrim" is the
    -- more useful of the two.
    raise exception 'This project already has a label called %', v_name
      using errcode = 'check_violation';
  end if;

  insert into public.project_labels (project_id, name, color, description, created_by)
  values (p_project_id, v_name, v_color,
          nullif(btrim(coalesce(p_description, '')), ''), (select auth.uid()))
  returning id into v_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.label_created', 'project', p_project_id::text,
    format('Label %s added to %s', v_name, v_project.name),
    jsonb_build_object('label_id', v_id, 'name', v_name, 'color', v_color)
  );
  return v_id;
end;
$fn$;

comment on function public.create_label is
  'Adds a label to a project. Requires tasks.manage. Colour is one of six tokens; a name is unique within its project, whatever its case.';

revoke execute on function public.create_label(uuid, text, text, text) from public, anon;
grant execute on function public.create_label(uuid, text, text, text) to authenticated;

create or replace function public.update_label(
  p_label_id uuid,
  p_name text default null,
  p_color text default null,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_label   public.project_labels;
  v_project public.projects;
  v_name    text;
  v_color   text;
begin
  select * into v_label from public.project_labels where id = p_label_id;
  if v_label.id is null then
    raise exception 'Label not found' using errcode = 'no_data_found';
  end if;

  select * into v_project from public.projects where id = v_label.project_id;
  perform public.assert_may_write_task(v_project, 'tasks.manage', 'manage labels');

  v_name  := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_label.name);
  v_color := lower(coalesce(nullif(btrim(coalesce(p_color, '')), ''), v_label.color));

  if char_length(v_name) > 40 then
    raise exception 'Keep the name under 40 characters' using errcode = 'check_violation';
  end if;
  if v_color not in ('violet', 'brass', 'success', 'warning', 'danger', 'neutral') then
    raise exception 'Unknown label colour: %', v_color using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.project_labels l
    where l.project_id = v_label.project_id
      and l.id <> p_label_id
      and lower(btrim(l.name)) = lower(v_name)
  ) then
    -- check_violation rather than unique_violation on purpose: `errors.ts`
    -- shows the routine's own words for that code and a generic sentence for
    -- this one, and "this project already has a label called scrim" is the
    -- more useful of the two.
    raise exception 'This project already has a label called %', v_name
      using errcode = 'check_violation';
  end if;

  update public.project_labels
  set name        = v_name,
      color       = v_color,
      description = case when p_description is null then description
                         else nullif(btrim(p_description), '') end
  where id = p_label_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.label_updated', 'project', v_label.project_id::text,
    format('Label %s updated', v_name),
    jsonb_build_object('label_id', p_label_id, 'name', v_name, 'color', v_color)
  );
end;
$fn$;

revoke execute on function public.update_label(uuid, text, text, text) from public, anon;
grant execute on function public.update_label(uuid, text, text, text) to authenticated;

create or replace function public.delete_label(p_label_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_label   public.project_labels;
  v_project public.projects;
  v_used    integer;
begin
  select * into v_label from public.project_labels where id = p_label_id;
  if v_label.id is null then
    raise exception 'Label not found' using errcode = 'no_data_found';
  end if;

  select * into v_project from public.projects where id = v_label.project_id;
  perform public.assert_may_write_task(v_project, 'tasks.manage', 'manage labels');

  select count(*) into v_used from public.task_labels where label_id = p_label_id;

  -- The join rows cascade. Nothing happens to the tasks themselves: a label is
  -- a thing said about work, not the work.
  delete from public.project_labels where id = p_label_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.label_deleted', 'project', v_label.project_id::text,
    format('Label %s deleted', v_label.name),
    jsonb_build_object('label_id', p_label_id, 'name', v_label.name, 'was_on', v_used)
  );
end;
$fn$;

comment on function public.delete_label is
  'Removes a label and takes it off every task it was on. The tasks themselves are untouched.';

revoke execute on function public.delete_label(uuid) from public, anon;
grant execute on function public.delete_label(uuid) to authenticated;

-- --- Labels on a task ------------------------------------------------------

create or replace function public.assign_label(p_task_id uuid, p_label_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_task    public.tasks;
  v_project public.projects;
  v_label   public.project_labels;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;

  select * into v_project from public.projects where id = v_task.project_id;
  perform public.assert_may_write_task(v_project, 'tasks.manage', 'label tasks');

  select * into v_label from public.project_labels where id = p_label_id;
  -- One message for "another project's label" and for "no such label": a
  -- caller elsewhere learns nothing either way.
  if v_label.id is null or v_label.project_id <> v_task.project_id then
    raise exception 'That label belongs to another project' using errcode = 'foreign_key_violation';
  end if;

  insert into public.task_labels (task_id, label_id, assigned_by)
  values (p_task_id, p_label_id, (select auth.uid()))
  on conflict (task_id, label_id) do nothing;

  -- Putting a label on twice is not an error, and not news either.
  if not found then
    return;
  end if;

  perform public.log_audit_event(
    v_project.organization_id, 'task.label_added', 'task', p_task_id::text,
    format('%s labelled %s', v_task.title, v_label.name),
    jsonb_build_object('project_id', v_task.project_id, 'label_id', p_label_id,
                       'label', v_label.name)
  );
end;
$fn$;

revoke execute on function public.assign_label(uuid, uuid) from public, anon;
grant execute on function public.assign_label(uuid, uuid) to authenticated;

create or replace function public.remove_label(p_task_id uuid, p_label_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_task    public.tasks;
  v_project public.projects;
  v_name    text;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;

  select * into v_project from public.projects where id = v_task.project_id;
  perform public.assert_may_write_task(v_project, 'tasks.manage', 'label tasks');

  select name into v_name from public.project_labels where id = p_label_id;

  delete from public.task_labels where task_id = p_task_id and label_id = p_label_id;
  if not found then
    raise exception 'That label is not on this task' using errcode = 'no_data_found';
  end if;

  perform public.log_audit_event(
    v_project.organization_id, 'task.label_removed', 'task', p_task_id::text,
    format('%s no longer labelled %s', v_task.title, coalesce(v_name, 'that')),
    jsonb_build_object('project_id', v_task.project_id, 'label_id', p_label_id, 'label', v_name)
  );
end;
$fn$;

revoke execute on function public.remove_label(uuid, uuid) from public, anon;
grant execute on function public.remove_label(uuid, uuid) to authenticated;

-- --- Comments --------------------------------------------------------------
--
-- Reading a task is the floor for all three: `assert_may_write_task` with
-- `tasks.view` is exactly "may see the work here, and the project is not
-- archived". Changing somebody else's words then needs `tasks.manage`, which
-- is the same shape `delete_message` has had since C1.

create or replace function public.create_task_comment(p_task_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_task    public.tasks;
  v_project public.projects;
  v_body    text := btrim(coalesce(p_body, ''));
  v_id      uuid;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;

  select * into v_project from public.projects where id = v_task.project_id;
  perform public.assert_may_write_task(v_project, 'tasks.view', 'comment on tasks');

  if v_body = '' then
    raise exception 'A comment needs something in it' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'Keep a comment under 4000 characters' using errcode = 'check_violation';
  end if;

  insert into public.task_comments (task_id, author_id, body)
  values (p_task_id, (select auth.uid()), v_body)
  returning id into v_id;

  perform public.log_audit_event(
    v_project.organization_id, 'task.comment_created', 'task', p_task_id::text,
    format('Comment added to %s', v_task.title),
    -- The words are not in the audit trail: more people can read that than
    -- can read the task.
    jsonb_build_object('project_id', v_task.project_id, 'comment_id', v_id)
  );
  return v_id;
end;
$fn$;

comment on function public.create_task_comment is
  'Adds a comment to a task. Requires tasks.view on the project, which is also what reading the task requires; an archived project takes none.';

revoke execute on function public.create_task_comment(uuid, text) from public, anon;
grant execute on function public.create_task_comment(uuid, text) to authenticated;

create or replace function public.update_task_comment(p_comment_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_comment public.task_comments;
  v_task    public.tasks;
  v_project public.projects;
  v_actor   uuid := (select auth.uid());
  v_body    text := btrim(coalesce(p_body, ''));
begin
  select * into v_comment from public.task_comments where id = p_comment_id;
  if v_comment.id is null then
    raise exception 'Comment not found' using errcode = 'no_data_found';
  end if;
  if v_comment.deleted_at is not null then
    raise exception 'That comment has been deleted' using errcode = 'check_violation';
  end if;

  select * into v_task from public.tasks where id = v_comment.task_id;
  select * into v_project from public.projects where id = v_task.project_id;
  perform public.assert_may_write_task(v_project, 'tasks.view', 'comment on tasks');

  -- Your own words, or somebody trusted with everything on the project.
  if v_comment.author_id is distinct from v_actor
     and not public.has_org_permission(v_project.organization_id, 'tasks.manage') then
    raise exception 'You can only edit your own comments' using errcode = 'insufficient_privilege';
  end if;

  if v_body = '' then
    raise exception 'A comment needs something in it' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'Keep a comment under 4000 characters' using errcode = 'check_violation';
  end if;

  update public.task_comments set body = v_body where id = p_comment_id;

  perform public.log_audit_event(
    v_project.organization_id, 'task.comment_updated', 'task', v_comment.task_id::text,
    format('Comment on %s edited', v_task.title),
    jsonb_build_object('project_id', v_task.project_id, 'comment_id', p_comment_id)
  );
end;
$fn$;

revoke execute on function public.update_task_comment(uuid, text) from public, anon;
grant execute on function public.update_task_comment(uuid, text) to authenticated;

create or replace function public.delete_task_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_comment public.task_comments;
  v_task    public.tasks;
  v_project public.projects;
  v_actor   uuid := (select auth.uid());
begin
  select * into v_comment from public.task_comments where id = p_comment_id;
  if v_comment.id is null then
    raise exception 'Comment not found' using errcode = 'no_data_found';
  end if;
  if v_comment.deleted_at is not null then
    raise exception 'That comment has already been deleted' using errcode = 'check_violation';
  end if;

  select * into v_task from public.tasks where id = v_comment.task_id;
  select * into v_project from public.projects where id = v_task.project_id;
  perform public.assert_may_write_task(v_project, 'tasks.view', 'comment on tasks');

  if v_comment.author_id is distinct from v_actor
     and not public.has_org_permission(v_project.organization_id, 'tasks.manage') then
    raise exception 'You can only delete your own comments'
      using errcode = 'insufficient_privilege';
  end if;

  -- The row stays, the record stays, and the words move somewhere no client
  -- has the privilege to select.
  update public.task_comments
  set deleted_body = v_comment.body,
      body         = '',
      deleted_at   = now(),
      deleted_by   = v_actor
  where id = p_comment_id;

  perform public.log_audit_event(
    v_project.organization_id, 'task.comment_deleted', 'task', v_comment.task_id::text,
    format('Comment on %s deleted', v_task.title),
    jsonb_build_object('project_id', v_task.project_id, 'comment_id', p_comment_id,
                       'author_id', v_comment.author_id)
  );
end;
$fn$;

comment on function public.delete_task_comment is
  'Soft-deletes a comment: the row and the audit entry stay, and the words move to deleted_body, which no client may select.';

revoke execute on function public.delete_task_comment(uuid) from public, anon;
grant execute on function public.delete_task_comment(uuid) to authenticated;

-- --- Realtime --------------------------------------------------------------
-- None of these three are in the publication, deliberately. Keeping a board
-- and its comments current between people is Phase 6.4, and the query keys are
-- already shaped for it: labels, task labels and comments each have their own
-- family under the project.
