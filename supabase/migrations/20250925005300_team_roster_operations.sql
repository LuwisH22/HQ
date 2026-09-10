-- ===========================================================================
-- LFG HQ · Phase 7.3 · What a roster is, beyond a list of names
--
-- 7.1 made a team and a list of who is on it. That answers "who", and an
-- operating roster has to answer two more questions before it is any use on a
-- Saturday: what each person does on the side, and whether they are starting.
--
-- Neither is invented here. The permission catalogue has said since
-- 20250901000200 that `teams.roster_manage` is for "Add, move and change the
-- status of players" — move and status, in those words, written before any of
-- this existed. This is that sentence, implemented.
--
-- Five decisions.
--
-- 1 · A position is a word, not a role.
--    Free text, because "Duelist", "IGL", "Analyst" and "Head coach" are not a
--    set anybody can enumerate in advance, and an enum would be a list to
--    maintain for no gain. It is operational metadata and nothing reads it:
--    no policy, no routine, no permission check anywhere in this schema
--    consults `roster_position`, and a grep for it outside this file and the
--    client that draws it returns nothing.
--
-- 2 · A roster status is not an account status.
--    `organization_members.status` decides whether somebody may use LFG HQ at
--    all — active, suspended, banned — and it is nowhere near this. A roster
--    status says whether they are starting on Saturday. The two are never read
--    together, never derived from one another, and this column can never
--    reinstate somebody the organization has suspended: every routine below
--    still goes through `has_org_permission`, which refuses a suspended
--    operator regardless of what any roster says.
--
-- 3 · Three values, because the third one is the point.
--    Starting, substitute, and not currently playing. A team that could only
--    say "on the roster" would have people removed to express "not this
--    split", which loses the fact that they are on the team at all.
--
-- 4 · Moving is one operation, not two.
--    A member already may belong to several teams — the primary key is the
--    pair — so moving is a real thing rather than a rename: off one, onto
--    another, in one statement, carrying the position and status across. Doing
--    it as two client calls would leave somebody on both teams, or on neither,
--    whenever the second call failed.
--
-- 5 · No ordering.
--    There is no `sort_order` here and no drag handle in the interface. A
--    roster is five to ten people and reads perfectly by status then name; a
--    fractional-position column of the kind the task board needs would be
--    machinery for a list that does not need it.
--
-- Additive only.
-- ===========================================================================

alter table public.team_members
  -- Not `position`: that is a function in the SQL standard and a column named
  -- after it needs quoting in places that are easy to forget.
  add column if not exists roster_position text,
  add column if not exists roster_status   text not null default 'active';

comment on column public.team_members.roster_position is
  'What this person does on this team, in whatever words the organization uses. Operational metadata: nothing in this schema reads it to decide anything.';
comment on column public.team_members.roster_status is
  'Whether they are starting, a substitute, or not currently playing. Unrelated to organization_members.status, which is what decides account access.';

alter table public.team_members
  drop constraint if exists team_members_position_length,
  add constraint team_members_position_length check (
    roster_position is null or char_length(btrim(roster_position)) between 1 and 40);

alter table public.team_members
  drop constraint if exists team_members_roster_status_valid,
  add constraint team_members_roster_status_valid check (
    roster_status in ('active', 'substitute', 'inactive'));

-- The list a roster reads in, and the count the team list draws.
create index if not exists team_members_team_status_idx
  on public.team_members (team_id, roster_status);

-- --- The three a roster status may be --------------------------------------

create or replace function public.assert_valid_roster_status(p_status text)
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_status not in ('active', 'substitute', 'inactive') then
    raise exception 'Unknown roster status: %', coalesce(p_status, '(null)')
      using errcode = 'check_violation';
  end if;
end;
$fn$;

comment on function public.assert_valid_roster_status is
  'Refuses a roster status this product does not have, as a sentence rather than as a constraint violation.';

grant execute on function public.assert_valid_roster_status(text) to authenticated;

-- --- Changing what somebody does on a team ---------------------------------
--
-- `teams.roster_manage`, and only that. A manager who may rename and archive a
-- team but was not given the roster permission cannot change a position here,
-- which is the arrangement the catalogue has always described.
--
-- Nothing operational reaches anywhere near account state: this routine writes
-- two columns on one roster row and touches nothing else. It cannot change an
-- organization role, a permission, an account status or an ownership.

create or replace function public.update_team_member(
  p_team_id uuid,
  p_member_id uuid,
  p_position text default null,
  -- Null already means "leave it alone" for the position, so taking one off
  -- has to say so in its own words.
  p_clear_position boolean default false,
  p_status text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_team     public.teams;
  v_existing public.team_members;
  v_position text;
  v_status   text;
begin
  select * into v_team from public.teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'Team not found' using errcode = 'no_data_found';
  end if;

  -- Absent and forbidden look the same to somebody in another organization:
  -- has_org_permission is false for both, and it also refuses an operator who
  -- is suspended or banned.
  if not public.has_org_permission(v_team.organization_id, 'teams.roster_manage') then
    raise exception 'You do not have permission to change this roster'
      using errcode = 'insufficient_privilege';
  end if;

  if v_team.archived_at is not null then
    raise exception 'That team is archived' using errcode = 'check_violation';
  end if;

  select * into v_existing from public.team_members
  where team_id = p_team_id and member_id = p_member_id;
  if v_existing.member_id is null then
    raise exception 'That person is not on this roster' using errcode = 'no_data_found';
  end if;

  v_position := case
                  when p_clear_position then null
                  else coalesce(nullif(btrim(coalesce(p_position, '')), ''),
                                v_existing.roster_position)
                end;
  v_status := lower(coalesce(nullif(btrim(coalesce(p_status, '')), ''), v_existing.roster_status));

  if v_position is not null and char_length(v_position) > 40 then
    raise exception 'Keep a position under 40 characters' using errcode = 'check_violation';
  end if;
  perform public.assert_valid_roster_status(v_status);

  update public.team_members
  set roster_position = v_position,
      roster_status   = v_status
  where team_id = p_team_id and member_id = p_member_id;

  perform public.log_audit_event(
    v_team.organization_id, 'team.roster_updated', 'team', p_team_id::text,
    format('Roster changed on %s', v_team.name),
    -- The membership, the position and the status. Not the person's name, not
    -- their address, and nothing about their account.
    jsonb_build_object('name', v_team.name, 'member_id', p_member_id,
                       'position', v_position, 'status', v_status)
  );
end;
$fn$;

comment on function public.update_team_member is
  'Sets what somebody does on a team and whether they are starting. Requires teams.roster_manage; an archived team takes no changes. Operational only: it cannot affect any permission, role or account status.';

revoke execute on function public.update_team_member(uuid, uuid, text, boolean, text)
  from public, anon;
grant execute on function public.update_team_member(uuid, uuid, text, boolean, text)
  to authenticated;

-- --- Moving somebody from one side to another ------------------------------
--
-- One statement, because two would be a way to end up on both teams or on
-- neither. What they did and whether they were starting travels with them:
-- somebody moved from the main side to the academy is still a duelist.
--
-- Both teams have to be in the same organization, and the check is not a
-- comparison of two arguments — it is `has_org_permission` asked about each
-- team's own organization, so a caller naming a team elsewhere is refused by
-- the same mechanism that refuses everything else. There is deliberately no
-- path here that crosses organizations, whatever is passed in.

create or replace function public.move_team_member(
  p_from_team_id uuid,
  p_to_team_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_from     public.teams;
  v_to       public.teams;
  v_existing public.team_members;
  v_member   public.organization_members;
begin
  if p_from_team_id = p_to_team_id then
    raise exception 'That is the team they are already on' using errcode = 'check_violation';
  end if;

  select * into v_from from public.teams where id = p_from_team_id;
  select * into v_to   from public.teams where id = p_to_team_id;
  if v_from.id is null or v_to.id is null then
    raise exception 'Team not found' using errcode = 'no_data_found';
  end if;

  -- Asked of each team separately. Two teams in different organizations means
  -- at least one of these is false for any caller, so the pairing is refused
  -- without ever comparing the two ids as though that were the rule.
  if not public.has_org_permission(v_from.organization_id, 'teams.roster_manage')
     or not public.has_org_permission(v_to.organization_id, 'teams.roster_manage') then
    raise exception 'You do not have permission to change this roster'
      using errcode = 'insufficient_privilege';
  end if;

  -- And said plainly as well, so the refusal is a sentence rather than a
  -- permission error that reads like a mistake.
  if v_from.organization_id <> v_to.organization_id then
    raise exception 'A member cannot be moved to another organization''s team'
      using errcode = 'foreign_key_violation';
  end if;

  if v_from.archived_at is not null or v_to.archived_at is not null then
    raise exception 'That team is archived' using errcode = 'check_violation';
  end if;

  select * into v_existing from public.team_members
  where team_id = p_from_team_id and member_id = p_member_id;
  if v_existing.member_id is null then
    raise exception 'That person is not on this roster' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from public.team_members
    where team_id = p_to_team_id and member_id = p_member_id
  ) then
    raise exception 'They are already on that team' using errcode = 'check_violation';
  end if;

  -- Still the organization's own person, and still allowed to be on a roster.
  select * into v_member from public.organization_members where id = p_member_id;
  if v_member.id is null or v_member.organization_id <> v_to.organization_id then
    raise exception 'That person is not a member of this organization'
      using errcode = 'foreign_key_violation';
  end if;
  if not public.is_effectively_active(v_member.status, v_member.suspended_until) then
    raise exception 'That person is not active in this organization'
      using errcode = 'check_violation';
  end if;

  insert into public.team_members
    (team_id, member_id, added_by, roster_position, roster_status)
  values
    (p_to_team_id, p_member_id, (select auth.uid()),
     v_existing.roster_position, v_existing.roster_status);

  delete from public.team_members
  where team_id = p_from_team_id and member_id = p_member_id;

  -- One entry, on the team they left, naming where they went: a reader
  -- following either team's history needs to see the same movement once.
  perform public.log_audit_event(
    v_from.organization_id, 'team.member_moved', 'team', p_from_team_id::text,
    format('Someone moved from %s to %s', v_from.name, v_to.name),
    jsonb_build_object('member_id', p_member_id,
                       'from_team_id', p_from_team_id, 'from_name', v_from.name,
                       'to_team_id', p_to_team_id, 'to_name', v_to.name,
                       'position', v_existing.roster_position,
                       'status', v_existing.roster_status)
  );
end;
$fn$;

comment on function public.move_team_member is
  'Moves a roster member from one team to another in one statement, carrying their position and status. Requires teams.roster_manage on both; neither team may be archived and both must belong to the same organization.';

revoke execute on function public.move_team_member(uuid, uuid, uuid) from public, anon;
grant execute on function public.move_team_member(uuid, uuid, uuid) to authenticated;
