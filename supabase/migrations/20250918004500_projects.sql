-- ===========================================================================
-- LFG HQ · Phase 6.1 · Projects foundation
--
-- Two tables, five routines, two read policies. No tasks, no board, no
-- labels, no comments, no realtime: this is the container the rest of Phase 6
-- fills, and nothing more.
--
-- Four decisions, because everything else follows from them.
--
-- 1 · No new permission, and no new authorization model.
--    `projects.view`, `projects.create`, `projects.manage` and
--    `projects.delete` have been in the catalogue since 20250901000200, with
--    role grants already written and the owner and admin templates holding
--    all four. This uses them. `projects.delete` is what archives, because
--    that is what its own description in the catalogue says it does.
--
-- 2 · Project membership is context, not authorization.
--    Being on a project does not let anybody read or change anything they
--    could not read or change anyway — `has_org_permission` decides all of
--    that, as it does everywhere else. Membership says who a project is for,
--    which is what assignment and filtering in later phases will need. No
--    policy in this file consults it.
--
-- 3 · A project member is a membership, not a person.
--    `project_members.member_id` references `organization_members`, so a
--    project member is by construction somebody in that organization, and
--    leaving the organization takes their project rows with them. Storing a
--    profile id instead would have made "same organization" a thing to check
--    rather than a thing that is true.
--
-- 4 · Archived, not deleted.
--    Nothing here hard-deletes a project, because tasks, comments and history
--    will hang off it and a cascade is not an undo. `status` carries it, and
--    the row stays.
--
-- Writes go through SECURITY DEFINER routines, as every protected write in
-- this schema does. There is no client write policy on either table.
--
-- Additive only.
-- ===========================================================================

-- --- Projects --------------------------------------------------------------

create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,

  name             text not null,
  description      text,

  -- Text with a CHECK rather than an enum: a fifth status should be a one-line
  -- change, and an enum cannot be extended and used in the same transaction.
  status           text not null default 'planned',

  -- Days, not instants. A project runs over dates somebody writes on a
  -- whiteboard; it does not start at 14:32 in a particular zone, and storing
  -- it as timestamptz would invite exactly that question.
  start_date       date,
  due_date         date,

  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint projects_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint projects_description_length check (
    description is null or char_length(description) <= 2000),
  constraint projects_status_valid check (
    status in ('planned', 'active', 'completed', 'archived')),
  -- Both or either may be absent; only the order of two real dates is a rule.
  constraint projects_dates_ordered check (
    start_date is null or due_date is null or due_date >= start_date)
);

comment on table public.projects is
  'An organization''s projects. Read by members holding projects.view; written only by the SECURITY DEFINER routines below.';

-- The list every screen asks for: this organization's projects, by status.
create index projects_org_status_idx on public.projects (organization_id, status);
-- And the one a schedule asks for.
create index projects_org_due_idx on public.projects (organization_id, due_date);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.tg_set_updated_at();

-- --- A project cannot change hands ----------------------------------------

create or replace function public.tg_project_org_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A project cannot be moved to another organization'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

create trigger projects_org_immutable
  before update on public.projects
  for each row execute function public.tg_project_org_immutable();

-- --- And its author belongs to it ------------------------------------------
-- The routine sets `created_by` to the caller, and the permission check it
-- passed already means they are an active member. This says so out loud, so a
-- future writer cannot introduce an author from somewhere else.

create or replace function public.tg_project_author_is_a_member()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.created_by is not null
     and not exists (
       select 1 from public.organization_members m
       where m.user_id = new.created_by
         and m.organization_id = new.organization_id
     ) then
    raise exception 'A project''s author has to be a member of its organization'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$fn$;

create trigger projects_author_is_a_member
  before insert or update on public.projects
  for each row execute function public.tg_project_author_is_a_member();

-- --- Project members -------------------------------------------------------
--
-- Who a project is for. Not who may see it — that is projects.view, on the
-- organization — and nothing in this file reads these rows to decide anything.
-- They exist so that assigning work in a later phase has a roster to assign
-- from, and so a project can say who is on it.

create table public.project_members (
  project_id  uuid not null references public.projects (id) on delete cascade,
  -- A membership, not a person: same organization is then true by
  -- construction, and leaving the organization takes these rows with it.
  member_id   uuid not null references public.organization_members (id) on delete cascade,
  added_by    uuid references public.profiles (id) on delete set null,
  added_at    timestamptz not null default now(),

  primary key (project_id, member_id)
);

comment on table public.project_members is
  'Who a project is for. Context, not authorization: organization permissions decide who may read or change anything.';

-- "Which projects is this member on?", for a later phase's my-work view.
create index project_members_member_idx on public.project_members (member_id);

create or replace function public.tg_project_member_same_org()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_project_org uuid;
  v_member_org  uuid;
begin
  select organization_id into v_project_org from public.projects where id = new.project_id;
  select organization_id into v_member_org
  from public.organization_members where id = new.member_id;

  if v_project_org is null or v_member_org is null or v_project_org <> v_member_org then
    raise exception 'A project member has to belong to the project''s organization'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$fn$;

create trigger project_members_same_org
  before insert or update on public.project_members
  for each row execute function public.tg_project_member_same_org();

-- --- RLS -------------------------------------------------------------------
-- Read only, and only for members holding projects.view in that organization.
-- has_org_permission already resolves ownership, membership status and every
-- role the member holds; nothing is re-decided here.

alter table public.projects enable row level security;

create policy "Members can read projects they may view"
  on public.projects for select to authenticated
  using (public.has_org_permission(organization_id, 'projects.view'));

revoke all on public.projects from anon;
grant select on public.projects to authenticated;

-- The project's organization, read past RLS so the policy below can ask about
-- it without joining a table that has a policy of its own.
create or replace function public.project_organization(p_project_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.organization_id from public.projects p where p.id = p_project_id;
$fn$;

comment on function public.project_organization is
  'The organization a project belongs to. SECURITY DEFINER so a policy can ask without recursing through the projects policy.';

revoke execute on function public.project_organization(uuid) from public, anon;
grant execute on function public.project_organization(uuid) to authenticated;

alter table public.project_members enable row level security;

create policy "Members can read the roster of a project they may view"
  on public.project_members for select to authenticated
  using (public.has_org_permission(public.project_organization(project_id), 'projects.view'));

revoke all on public.project_members from anon;
grant select on public.project_members to authenticated;

-- --- Shared checks ---------------------------------------------------------

create or replace function public.assert_valid_project_status(p_status text)
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_status not in ('planned', 'active', 'completed', 'archived') then
    raise exception 'Unknown project status: %', coalesce(p_status, '(null)')
      using errcode = 'check_violation';
  end if;
end;
$fn$;

comment on function public.assert_valid_project_status is
  'Refuses a status this product does not have, as a sentence rather than as a constraint violation.';

grant execute on function public.assert_valid_project_status(text) to authenticated;

-- --- Creating --------------------------------------------------------------

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

  -- Archived is somewhere a project arrives, not somewhere it starts.
  if v_status = 'archived' then
    raise exception 'A new project cannot start out archived'
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

  -- Whoever started it is on it. Their membership is guaranteed by the
  -- permission check above, so this cannot introduce somebody from elsewhere.
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

comment on function public.create_project is
  'Creates a project and puts its author on it. Requires projects.create; the organization is the caller''s argument but the permission check is what decides it.';

revoke execute on function public.create_project(uuid, text, text, text, date, date)
  from public, anon;
grant execute on function public.create_project(uuid, text, text, text, date, date)
  to authenticated;

-- --- Editing ---------------------------------------------------------------
--
-- A partial update, in this schema's usual shape: a null argument leaves the
-- column alone, and an empty description clears it. Dates need saying out
-- loud, because null already means "leave it", so there are two flags for
-- taking a date off a project.

create or replace function public.update_project(
  p_project_id uuid,
  p_name text default null,
  p_description text default null,
  p_status text default null,
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
  v_status  text;
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

  v_name   := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_project.name);
  v_status := lower(coalesce(nullif(btrim(coalesce(p_status, '')), ''), v_project.status));
  v_start  := case when p_clear_start_date then null
                   else coalesce(p_start_date, v_project.start_date) end;
  v_due    := case when p_clear_due_date then null
                   else coalesce(p_due_date, v_project.due_date) end;

  if char_length(v_name) > 120 then
    raise exception 'Keep the name under 120 characters' using errcode = 'check_violation';
  end if;

  perform public.assert_valid_project_status(v_status);

  -- Archiving is its own routine, with its own permission. Going the other
  -- way is an ordinary edit: bringing something back is not the destructive
  -- direction.
  if v_status = 'archived' and v_project.status <> 'archived' then
    raise exception 'Use archiving to archive a project' using errcode = 'check_violation';
  end if;

  if v_start is not null and v_due is not null and v_due < v_start then
    raise exception 'A project cannot be due before it starts' using errcode = 'check_violation';
  end if;

  update public.projects
  set name        = v_name,
      description = case when p_description is null then description
                         else nullif(btrim(p_description), '') end,
      status      = v_status,
      start_date  = v_start,
      due_date    = v_due
  where id = p_project_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.updated', 'project', p_project_id::text,
    format('Project %s updated', v_name),
    jsonb_build_object('name', v_name, 'status', v_status,
                       'start_date', v_start, 'due_date', v_due)
  );
end;
$fn$;

comment on function public.update_project is
  'Partial update: a null argument leaves the column alone. Requires projects.manage. Archiving is a separate routine with a separate permission; restoring from archived is an ordinary edit.';

revoke execute on function public.update_project(uuid, text, text, text, date, date, boolean, boolean)
  from public, anon;
grant execute on function public.update_project(uuid, text, text, text, date, date, boolean, boolean)
  to authenticated;

-- --- Archiving -------------------------------------------------------------
-- Nothing is deleted. Tasks, comments and history will hang off a project in
-- the phases after this one, and a cascade is not an undo.

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

  -- The catalogue's own words for projects.delete: "Archive or delete a
  -- project." This is that permission, doing that.
  if not public.has_org_permission(v_project.organization_id, 'projects.delete') then
    raise exception 'You do not have permission to archive this project'
      using errcode = 'insufficient_privilege';
  end if;

  if v_project.status = 'archived' then
    raise exception 'That project is already archived' using errcode = 'check_violation';
  end if;

  update public.projects set status = 'archived' where id = p_project_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.archived', 'project', p_project_id::text,
    format('Project %s archived', v_project.name),
    jsonb_build_object('name', v_project.name, 'was', v_project.status)
  );
end;
$fn$;

comment on function public.archive_project is
  'Moves a project to archived and leaves every row it owns in place. Requires projects.delete.';

revoke execute on function public.archive_project(uuid) from public, anon;
grant execute on function public.archive_project(uuid) to authenticated;

-- --- Who a project is for --------------------------------------------------

create or replace function public.add_project_member(
  p_project_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project public.projects;
  v_member  public.organization_members;
  v_name    text;
begin
  select * into v_project from public.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'Project not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_project.organization_id, 'projects.manage') then
    raise exception 'You do not have permission to change who is on this project'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_member from public.organization_members where id = p_member_id;
  -- One message for "not in this organization" and for "no such membership":
  -- a caller in another organization learns nothing either way.
  if v_member.id is null or v_member.organization_id <> v_project.organization_id then
    raise exception 'That person is not in this organization'
      using errcode = 'foreign_key_violation';
  end if;

  if not public.is_effectively_active(v_member.status, v_member.suspended_until) then
    raise exception 'That member is not active' using errcode = 'check_violation';
  end if;

  insert into public.project_members (project_id, member_id, added_by)
  values (p_project_id, p_member_id, (select auth.uid()))
  on conflict (project_id, member_id) do nothing;

  -- Adding somebody twice is not an error, but it is not news either.
  if not found then
    return;
  end if;

  select coalesce(pr.display_name, pr.full_name, pr.email) into v_name
  from public.profiles pr where pr.id = v_member.user_id;

  perform public.log_audit_event(
    v_project.organization_id, 'project.member_added', 'project', p_project_id::text,
    format('%s added to %s', coalesce(v_name, 'A member'), v_project.name),
    jsonb_build_object('project', v_project.name, 'member_id', p_member_id,
                       'user_id', v_member.user_id)
  );
end;
$fn$;

comment on function public.add_project_member is
  'Puts an active member of the project''s own organization on it. Requires projects.manage. Adding somebody already on it does nothing.';

revoke execute on function public.add_project_member(uuid, uuid) from public, anon;
grant execute on function public.add_project_member(uuid, uuid) to authenticated;

create or replace function public.remove_project_member(
  p_project_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project public.projects;
  v_user    uuid;
  v_name    text;
begin
  select * into v_project from public.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'Project not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_project.organization_id, 'projects.manage') then
    raise exception 'You do not have permission to change who is on this project'
      using errcode = 'insufficient_privilege';
  end if;

  select m.user_id into v_user
  from public.organization_members m where m.id = p_member_id;

  delete from public.project_members
  where project_id = p_project_id and member_id = p_member_id;

  if not found then
    raise exception 'That member is not on this project' using errcode = 'no_data_found';
  end if;

  select coalesce(pr.display_name, pr.full_name, pr.email) into v_name
  from public.profiles pr where pr.id = v_user;

  perform public.log_audit_event(
    v_project.organization_id, 'project.member_removed', 'project', p_project_id::text,
    format('%s removed from %s', coalesce(v_name, 'A member'), v_project.name),
    jsonb_build_object('project', v_project.name, 'member_id', p_member_id, 'user_id', v_user)
  );
end;
$fn$;

comment on function public.remove_project_member is
  'Takes a member off a project. Requires projects.manage. Membership is context, so this changes who the project is for and nothing about who may read it.';

revoke execute on function public.remove_project_member(uuid, uuid) from public, anon;
grant execute on function public.remove_project_member(uuid, uuid) to authenticated;

-- --- Realtime --------------------------------------------------------------
-- Deliberately not added to the publication. Phase 6.4 is where projects learn
-- to keep themselves current, and adding a table to a publication it does not
-- need yet is a thing that looks harmless until somebody relies on it.
