-- ===========================================================================
-- LFG HQ · Phase 7.1 · Teams foundation
--
-- Two tables, one helper, six routines, two read policies. No UI, no roster
-- history, no matches, no statistics: this is the grouping the rest of Phase 7
-- hangs off, and nothing more.
--
-- Six decisions, because everything else follows from them.
--
-- 1 · No new permission. Not one.
--    `teams.view`, `teams.manage` and `teams.roster_manage` have been in the
--    catalogue since 20250901000200, with role grants already written, and
--    their descriptions say exactly what this phase needed: "See teams and
--    rosters", "Create and configure teams", "Add, move and change the status
--    of players". Adding `teams.create` and `teams.delete` would have been two
--    new ways to say what `teams.manage` already says, with grants invented to
--    match. This uses what is there.
--
-- 2 · Configuring a team and managing its roster are different jobs.
--    Not an invention either — the catalogue already grants `teams.manage` to
--    manager alone and `teams.roster_manage` to manager and coach. A coach
--    picking the side for Saturday without being able to rename or archive the
--    team is a real arrangement somebody wrote down before any of this existed,
--    and it is the arrangement these routines enforce.
--
-- 3 · Archived is a column, not a status.
--    6.5 spent a migration taking `archived` out of a status enumeration for
--    exactly the reason it would be wrong here: a status column would be a
--    second way of saying the one thing this flag says. `archived_at` also
--    records when, which a status never did.
--
-- 4 · Nothing is deleted, and nothing pretends to be.
--    Teams are the thing rosters, projects, scrims and results will hang off,
--    and a cascade is not an undo. There is also no `teams.delete` permission
--    to gate one with. Archiving is the whole of it in 7.1; when something
--    finally references a team, the safe deletion model can be designed with
--    that in front of it rather than guessed at now.
--
-- 5 · Team membership is context, never authorization.
--    Exactly as project membership has been since 6.1: no policy in this file
--    consults `team_members`, and nothing in it grants or removes anything.
--    Putting somebody on a team says who the team is for. What they may do
--    still comes from ownership, their roles and `has_org_permission`, and
--    taking them off a team leaves every one of those untouched.
--
-- 6 · A team and its people belong to the same organization, and Postgres says so.
--    `member_id` references `organization_members`, so a team member is by
--    construction somebody in some organization, and a trigger refuses the
--    pairing when it is not this one — the same shape `project_members` uses.
--
-- Writes go through SECURITY DEFINER routines, as every protected write in
-- this schema does. There is no client write policy on either table.
--
-- Additive only.
-- ===========================================================================

-- --- Teams -----------------------------------------------------------------

create table if not exists public.teams (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,

  name             text not null,
  description      text,

  -- When it was put away, or null. No status column: there are two states and
  -- this says which, and unlike a status it also says when.
  archived_at      timestamptz,

  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint teams_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint teams_description_length check (
    description is null or char_length(description) <= 2000)
);

comment on table public.teams is
  'An organization''s teams. Read by members holding teams.view; written only by the SECURITY DEFINER routines below.';
comment on column public.teams.archived_at is
  'When the team was put away, or null. A team, unlike a project, has no lifecycle beyond this.';

-- The list every screen will ask for: this organization's teams, unarchived
-- first and by name.
create index if not exists teams_org_archived_idx
  on public.teams (organization_id, archived_at);

drop trigger if exists teams_set_updated_at on public.teams;
create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.tg_set_updated_at();

-- A team cannot change hands. Same shape as `tg_project_org_immutable`.
create or replace function public.tg_team_org_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A team cannot change organizations'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists teams_org_immutable on public.teams;
create trigger teams_org_immutable
  before update on public.teams
  for each row execute function public.tg_team_org_immutable();

-- And it cannot be created by somebody who is not there. The routine checks
-- the permission, which implies membership; this is the floor under it, so a
-- row written any other way still cannot name a stranger as its author.
create or replace function public.tg_team_author_is_a_member()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.created_by is null then return new; end if;

  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.created_by
  ) then
    raise exception 'A team''s author has to belong to its organization'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists teams_author_is_a_member on public.teams;
create trigger teams_author_is_a_member
  before insert or update on public.teams
  for each row execute function public.tg_team_author_is_a_member();

-- --- Who a team is for -----------------------------------------------------
--
-- A team member is a membership, not a person: `member_id` references
-- `organization_members`, so somebody leaving the organization takes their
-- team rows with them and "same organization" is a thing that is true rather
-- than a thing to check. Storing a profile id instead would have made it the
-- second kind.

create table if not exists public.team_members (
  team_id     uuid not null references public.teams (id) on delete cascade,
  member_id   uuid not null references public.organization_members (id) on delete cascade,
  added_by    uuid references public.profiles (id) on delete set null,
  added_at    timestamptz not null default now(),

  primary key (team_id, member_id)
);

comment on table public.team_members is
  'Who a team is for. Context, never authorization: no policy anywhere consults this table to decide what somebody may do.';

-- "Which teams is this person on?", which the member page will ask.
create index if not exists team_members_member_idx on public.team_members (member_id);

create or replace function public.tg_team_member_same_org()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_team_org   uuid;
  v_member_org uuid;
begin
  select organization_id into v_team_org from public.teams where id = new.team_id;
  select organization_id into v_member_org
  from public.organization_members where id = new.member_id;

  -- Either direction of the mismatch, and the missing-row case as well.
  if v_team_org is null or v_member_org is null or v_team_org <> v_member_org then
    raise exception 'A team member has to belong to the team''s organization'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists team_members_same_org on public.team_members;
create trigger team_members_same_org
  before insert or update on public.team_members
  for each row execute function public.tg_team_member_same_org();

-- --- Reading ---------------------------------------------------------------
--
-- Read only, and only for members holding teams.view in that organization.
-- `has_org_permission` already resolves ownership, membership status —
-- including a suspension that has not lapsed and a ban that never will — and
-- every role the member holds. Nothing is re-decided here, and nothing here
-- consults `team_members`, so there is no policy on one table that has to read
-- the other and no recursion to avoid.

alter table public.teams enable row level security;

drop policy if exists "Members can read teams they may view" on public.teams;
create policy "Members can read teams they may view"
  on public.teams for select to authenticated
  using (public.has_org_permission(organization_id, 'teams.view'));

revoke all on public.teams from anon;
grant select on public.teams to authenticated;

-- The roster's policy needs the team's organization, and asking `teams` for it
-- from inside a policy would read a table that has a policy of its own. A
-- SECURITY DEFINER lookup answers the question directly, the same way
-- `project_organization` does for projects.
create or replace function public.team_organization(p_team_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select t.organization_id from public.teams t where t.id = p_team_id;
$fn$;

comment on function public.team_organization is
  'The organization a team belongs to. SECURITY DEFINER so a policy can ask without recursing through the teams policy.';

revoke execute on function public.team_organization(uuid) from public, anon;
grant execute on function public.team_organization(uuid) to authenticated;

alter table public.team_members enable row level security;

drop policy if exists "Members can read the roster of a team they may view"
  on public.team_members;
create policy "Members can read the roster of a team they may view"
  on public.team_members for select to authenticated
  using (public.has_org_permission(public.team_organization(team_id), 'teams.view'));

revoke all on public.team_members from anon;
grant select on public.team_members to authenticated;

-- --- Making one ------------------------------------------------------------
--
-- `teams.manage` — "Create and configure teams", which is what the catalogue
-- has always said it is for.
--
-- The creator is deliberately not put on the team. Projects do that, and it is
-- right there: a project's author is working on it. A team is a side, and
-- whoever writes down that the organization has a Valorant roster is usually a
-- manager who does not play in it. Putting them on it would also be a roster
-- write performed by somebody who may hold `teams.manage` without holding
-- `teams.roster_manage` — the one permission that is supposed to decide who is
-- on a team. Nothing is added; the roster starts empty and is filled on purpose.

create or replace function public.create_team(
  p_organization_id uuid,
  p_name text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_id    uuid;
  v_actor uuid := (select auth.uid());
begin
  -- The organization arrives as an argument and decides nothing: this is what
  -- decides. A caller naming somebody else's organization is refused here.
  if not public.has_org_permission(p_organization_id, 'teams.manage') then
    raise exception 'You do not have permission to create teams'
      using errcode = 'insufficient_privilege';
  end if;

  if v_name = '' then
    raise exception 'A team needs a name' using errcode = 'check_violation';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep the name under 80 characters' using errcode = 'check_violation';
  end if;

  insert into public.teams (organization_id, name, description, created_by)
  values (p_organization_id, v_name,
          nullif(btrim(coalesce(p_description, '')), ''), v_actor)
  returning id into v_id;

  perform public.log_audit_event(
    p_organization_id, 'team.created', 'team', v_id::text,
    format('Team %s created', v_name),
    jsonb_build_object('name', v_name)
  );
  return v_id;
end;
$fn$;

comment on function public.create_team is
  'Creates a team with an empty roster. Requires teams.manage; the organization is the caller''s argument but the permission check is what decides it.';

revoke execute on function public.create_team(uuid, text, text) from public, anon;
grant execute on function public.create_team(uuid, text, text) to authenticated;

-- --- Changing one ----------------------------------------------------------

create or replace function public.update_team(
  p_team_id uuid,
  p_name text default null,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_team public.teams;
  v_name text;
begin
  select * into v_team from public.teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'Team not found' using errcode = 'no_data_found';
  end if;

  -- Absent and forbidden look the same to somebody in another organization:
  -- has_org_permission is false for both.
  if not public.has_org_permission(v_team.organization_id, 'teams.manage') then
    raise exception 'You do not have permission to change this team'
      using errcode = 'insufficient_privilege';
  end if;

  if v_team.archived_at is not null then
    raise exception 'That team is archived' using errcode = 'check_violation';
  end if;

  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_team.name);
  if char_length(v_name) > 80 then
    raise exception 'Keep the name under 80 characters' using errcode = 'check_violation';
  end if;

  update public.teams
  set name        = v_name,
      -- Null leaves it alone; an empty string clears it. The same partial
      -- shape every other update in this schema uses.
      description = case when p_description is null then description
                         else nullif(btrim(p_description), '') end
  where id = p_team_id;

  perform public.log_audit_event(
    v_team.organization_id, 'team.updated', 'team', p_team_id::text,
    format('Team %s updated', v_name),
    jsonb_build_object('name', v_name)
  );
end;
$fn$;

comment on function public.update_team is
  'Partial update of a team''s name and description: a null argument leaves the column alone. Requires teams.manage; an archived team takes no edits.';

revoke execute on function public.update_team(uuid, text, text) from public, anon;
grant execute on function public.update_team(uuid, text, text) to authenticated;

-- --- Putting away, and taking back out -------------------------------------
--
-- Both under `teams.manage`. There is no `teams.delete` in the catalogue, and
-- inventing one to gate an action that only sets a timestamp would be adding a
-- permission to justify a routine rather than the other way round.
--
-- Nothing is destroyed either way: an archived team keeps its roster exactly
-- as it was, and restoring gives it back rather than rebuilding it.

create or replace function public.archive_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'Team not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_team.organization_id, 'teams.manage') then
    raise exception 'You do not have permission to archive this team'
      using errcode = 'insufficient_privilege';
  end if;

  if v_team.archived_at is not null then
    raise exception 'That team is already archived' using errcode = 'check_violation';
  end if;

  update public.teams set archived_at = now() where id = p_team_id;

  perform public.log_audit_event(
    v_team.organization_id, 'team.archived', 'team', p_team_id::text,
    format('Team %s archived', v_team.name),
    jsonb_build_object('name', v_team.name)
  );
end;
$fn$;

comment on function public.archive_team is
  'Puts a team away with its roster intact. Requires teams.manage. Nothing here deletes anything: teams are what rosters and results will hang off, and a cascade is not an undo.';

revoke execute on function public.archive_team(uuid) from public, anon;
grant execute on function public.archive_team(uuid) to authenticated;

create or replace function public.restore_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'Team not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_team.organization_id, 'teams.manage') then
    raise exception 'You do not have permission to restore this team'
      using errcode = 'insufficient_privilege';
  end if;

  if v_team.archived_at is null then
    raise exception 'That team is not archived' using errcode = 'check_violation';
  end if;

  -- The same team, with the same people on it. Nothing is recreated.
  update public.teams set archived_at = null where id = p_team_id;

  perform public.log_audit_event(
    v_team.organization_id, 'team.restored', 'team', p_team_id::text,
    format('Team %s restored', v_team.name),
    jsonb_build_object('name', v_team.name)
  );
end;
$fn$;

comment on function public.restore_team is
  'Takes a team back out of the archive with the roster it was put away with. Requires teams.manage.';

revoke execute on function public.restore_team(uuid) from public, anon;
grant execute on function public.restore_team(uuid) to authenticated;

-- --- The roster ------------------------------------------------------------
--
-- `teams.roster_manage` — "Add, move and change the status of players". The
-- catalogue grants it to manager and coach, and `teams.manage` to manager
-- alone, so a coach can pick the side for Saturday without being able to
-- rename or archive the team. That distinction was written down before any of
-- this existed; these two routines are what make it real.

create or replace function public.add_team_member(
  p_team_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_team   public.teams;
  v_member public.organization_members;
begin
  select * into v_team from public.teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'Team not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_team.organization_id, 'teams.roster_manage') then
    raise exception 'You do not have permission to change this roster'
      using errcode = 'insufficient_privilege';
  end if;

  if v_team.archived_at is not null then
    raise exception 'That team is archived' using errcode = 'check_violation';
  end if;

  select * into v_member from public.organization_members where id = p_member_id;
  if v_member.id is null then
    raise exception 'That person is not a member of this organization'
      using errcode = 'no_data_found';
  end if;

  -- Said here as a sentence, and refused by the trigger underneath whatever
  -- happens: a team and its people belong to the same organization.
  if v_member.organization_id <> v_team.organization_id then
    raise exception 'That person is not a member of this organization'
      using errcode = 'foreign_key_violation';
  end if;

  -- A suspension that has not lapsed, or a ban: `is_effectively_active` is the
  -- same derivation the rest of the application reads access from, so a
  -- reinstated member becomes selectable again without anything being written.
  if not public.is_effectively_active(v_member.status, v_member.suspended_until) then
    raise exception 'That person is not active in this organization'
      using errcode = 'check_violation';
  end if;

  -- Already on it is not a failure worth a stack trace. The primary key makes
  -- it impossible; this makes it quiet.
  insert into public.team_members (team_id, member_id, added_by)
  values (p_team_id, p_member_id, (select auth.uid()))
  on conflict do nothing;

  perform public.log_audit_event(
    v_team.organization_id, 'team.member_added', 'team', p_team_id::text,
    format('Someone added to %s', v_team.name),
    -- The membership, not the person: an audit entry records that a roster
    -- changed, and the row it points at says the rest.
    jsonb_build_object('name', v_team.name, 'member_id', p_member_id)
  );
end;
$fn$;

comment on function public.add_team_member is
  'Puts an active member of the team''s organization on its roster. Requires teams.roster_manage. Membership is context: this grants nothing.';

revoke execute on function public.add_team_member(uuid, uuid) from public, anon;
grant execute on function public.add_team_member(uuid, uuid) to authenticated;

create or replace function public.remove_team_member(
  p_team_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'Team not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_team.organization_id, 'teams.roster_manage') then
    raise exception 'You do not have permission to change this roster'
      using errcode = 'insufficient_privilege';
  end if;

  if v_team.archived_at is not null then
    raise exception 'That team is archived' using errcode = 'check_violation';
  end if;

  -- Taking the last person off is allowed. A team between rosters is an
  -- ordinary thing, and a minimum-roster rule would be one invented here.
  delete from public.team_members
  where team_id = p_team_id and member_id = p_member_id;

  perform public.log_audit_event(
    v_team.organization_id, 'team.member_removed', 'team', p_team_id::text,
    format('Someone removed from %s', v_team.name),
    jsonb_build_object('name', v_team.name, 'member_id', p_member_id)
  );
end;
$fn$;

comment on function public.remove_team_member is
  'Takes a member off a team''s roster and changes nothing else. Requires teams.roster_manage; their organization membership, roles and permissions are untouched.';

revoke execute on function public.remove_team_member(uuid, uuid) from public, anon;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;
