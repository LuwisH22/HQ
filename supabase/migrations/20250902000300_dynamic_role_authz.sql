-- ===========================================================================
-- LFG HQ · Phase 1.5 · B1 · Name-independent authorization
--
-- After this migration, no function and no policy reads a role's name, key or
-- is_system flag to decide anything. Authority comes from exactly two places:
--
--   * organizations.owner_id  — ownership, absolute, not a permission
--   * roles.rank              — hierarchy for everyone else (lower = higher)
--
-- Renaming a role changes nothing. Creating a role called "Owner" grants
-- nothing. Deleting the role that used to be called "Owner" does not affect
-- who owns the organization.
--
-- Effective rank
--   owner            -> -1   (outranks every possible role)
--   member           -> min(rank) across the roles they hold
--   non-member       -> null
--
-- Effective permissions
--   owner            -> the entire catalogue, implicitly
--   member           -> union of role_permissions across the roles they hold
--
-- Hierarchy rule, applied everywhere: you may only act on a role or a member
-- STRICTLY below your own effective rank. Equal authority is not enough — that
-- is a deliberate tightening over the previous `>=`, and it is what stops two
-- peers from rewriting each other.
-- ===========================================================================

-- --- Effective rank --------------------------------------------------------

create or replace function public.my_role_rank(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when exists (
      select 1
      from public.organizations o
      join public.organization_members m
        on m.organization_id = o.id
       and m.user_id = (select auth.uid())
       and m.status = 'active'
      where o.id = p_organization_id
        and o.owner_id = (select auth.uid())
    ) then -1
    else (
      select min(r.rank)
      from public.organization_members m
      join public.member_roles mr on mr.member_id = m.id
      join public.roles r on r.id = mr.role_id
      where m.organization_id = p_organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
  end;
$fn$;

comment on function public.my_role_rank is
  'Effective authority of the caller. -1 for the owner, otherwise the most authoritative role held. Never derived from a role name.';

-- --- Effective permissions -------------------------------------------------

create or replace function public.has_org_permission(p_organization_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    exists (
      select 1
      from public.organizations o
      join public.organization_members m
        on m.organization_id = o.id
       and m.user_id = (select auth.uid())
       and m.status = 'active'
      where o.id = p_organization_id
        and o.owner_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.organization_members m
      join public.member_roles mr on mr.member_id = m.id
      join public.role_permissions rp on rp.role_id = mr.role_id
      where m.organization_id = p_organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and rp.permission_key = p_permission
    );
$fn$;

comment on function public.has_org_permission is
  'Authoritative permission check. The owner implicitly holds everything, so no permission edit can lock them out of their own organization.';

create or replace function public.my_permissions(p_organization_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.key
  from public.permissions p
  where exists (
    select 1
    from public.organizations o
    join public.organization_members m
      on m.organization_id = o.id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
    where o.id = p_organization_id
      and o.owner_id = (select auth.uid())
  )
  union
  select distinct rp.permission_key
  from public.organization_members m
  join public.member_roles mr on mr.member_id = m.id
  join public.role_permissions rp on rp.role_id = mr.role_id
  where m.organization_id = p_organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active';
$fn$;

-- --- Membership guard ------------------------------------------------------
-- Rewritten so the last-owner invariant hangs off organizations.owner_id
-- instead of `rank = 0`. Because ownership no longer comes from a role, the
-- owner's roles may now be changed freely — it costs them nothing.

create or replace function public.tg_guard_member_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor_rank   integer;
  v_target_rank  integer;
  v_new_rank     integer;
  v_owner_id     uuid;
  v_target       public.organization_members;
begin
  -- NEW is unassigned in a DELETE trigger, so branch rather than using CASE,
  -- which plpgsql would evaluate eagerly.
  if tg_op = 'DELETE' then
    v_target := old;
  else
    v_target := new;
  end if;

  -- No JWT (service role, migrations, seed scripts): trusted context.
  if (select auth.uid()) is null then
    return v_target;
  end if;

  select o.owner_id into v_owner_id
  from public.organizations o where o.id = old.organization_id;

  -- The owner outranks every role that could ever exist.
  if old.user_id = v_owner_id then
    v_target_rank := -1;
  else
    select min(r.rank) into v_target_rank
    from public.member_roles mr
    join public.roles r on r.id = mr.role_id
    where mr.member_id = old.id;
  end if;

  select public.my_role_rank(old.organization_id) into v_actor_rank;

  if v_actor_rank is null then
    raise exception 'Not a member of this organization' using errcode = 'insufficient_privilege';
  end if;

  -- The owner may act on anyone. Everyone else may only act on members with
  -- strictly less authority, which also stops peers from demoting each other.
  -- A member with no roles at all (v_target_rank null) is treated as
  -- untouchable by non-owners rather than as maximally weak.
  if old.user_id <> (select auth.uid())
     and v_actor_rank > -1
     and (v_target_rank is null or v_target_rank <= v_actor_rank) then
    raise exception 'Cannot modify a member whose role ranks at or above your own'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' and new.role_id is distinct from old.role_id then
    select r.rank into v_new_rank from public.roles r where r.id = new.role_id;
    if v_actor_rank > -1 and v_new_rank <= v_actor_rank then
      raise exception 'Cannot grant a role with authority at or above your own'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- The owner cannot be removed or deactivated. Unlike the previous rule this
  -- does not count owners: there is exactly one, named on the organization, so
  -- the only way out is an explicit ownership transfer.
  if old.user_id = v_owner_id then
    if tg_op = 'DELETE' then
      raise exception 'The organization owner cannot be removed. Transfer ownership first.'
        using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status <> 'active' then
      raise exception 'The organization owner cannot be deactivated. Transfer ownership first.'
        using errcode = 'check_violation';
    end if;
  end if;

  return v_target;
end;
$fn$;

-- --- Provisioning ----------------------------------------------------------
-- bootstrap_organization no longer looks up `key = 'owner'`. It records the
-- owner on the organization and grants the most authoritative provisioned role
-- purely so the new owner starts with a sensible primary role for display.

create or replace function public.bootstrap_organization(
  p_slug text,
  p_name text,
  p_owner_id uuid,
  p_tagline text default null,
  p_timezone text default 'UTC'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org_id     uuid;
  v_role       record;
  v_top_role   uuid;
  v_member_id  uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = p_owner_id) then
    raise exception 'Owner profile % does not exist', p_owner_id;
  end if;

  insert into public.organizations (slug, name, tagline, timezone, owner_id)
  values (p_slug, p_name, p_tagline, p_timezone, p_owner_id)
  returning id into v_org_id;

  -- Provision the default roles. These are ordinary, fully mutable roles: the
  -- organization may rename, reorder or delete any of them.
  for v_role in select * from public.role_templates order by rank loop
    insert into public.roles (organization_id, key, name, description, rank, is_system)
    values (v_org_id, v_role.key, v_role.name, v_role.description, v_role.rank, true);
  end loop;

  insert into public.role_permissions (role_id, permission_key)
  select r.id, tp.permission_key
  from public.roles r
  join public.role_template_permissions tp on tp.role_template_key = r.key
  where r.organization_id = v_org_id;

  -- Most authoritative provisioned role, by rank — not by name.
  select id into v_top_role
  from public.roles
  where organization_id = v_org_id
  order by rank asc
  limit 1;

  insert into public.organization_members (organization_id, user_id, role_id, status)
  values (v_org_id, p_owner_id, v_top_role, 'active')
  returning id into v_member_id;

  insert into public.member_roles (member_id, role_id) values (v_member_id, v_top_role);

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, summary)
  values (v_org_id, p_owner_id, 'organization.created', 'organization', v_org_id::text,
          format('Organization %s created', p_name));

  return v_org_id;
end;
$fn$;

-- --- Invitation acceptance -------------------------------------------------
-- Minimal change: the membership insert now also records the role in
-- member_roles. Everything else about this routine — the pending/expiry checks
-- and the email identity match — is untouched.

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_invitation  public.invitations;
  v_user_id     uuid := (select auth.uid());
  v_user_email  text;
  v_member_id   uuid;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to accept an invitation'
      using errcode = 'insufficient_privilege';
  end if;

  select lower(btrim(email)) into v_user_email from auth.users where id = v_user_id;

  select * into v_invitation
  from public.invitations
  where token_hash = public.hash_invitation_token(p_token)
  for update;

  if v_invitation is null then
    raise exception 'This invitation link is not valid' using errcode = 'no_data_found';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'This invitation has already been used' using errcode = 'check_violation';
  end if;

  if v_invitation.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_invitation.id;
    raise exception 'This invitation has expired' using errcode = 'check_violation';
  end if;

  if v_invitation.email <> v_user_email then
    raise exception 'This invitation was issued to a different email address'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.organization_members (organization_id, user_id, role_id, status)
  values (v_invitation.organization_id, v_user_id, v_invitation.role_id, 'active')
  on conflict (organization_id, user_id) do nothing
  returning id into v_member_id;

  -- Already a member: reuse the existing row rather than failing.
  if v_member_id is null then
    select id into v_member_id
    from public.organization_members
    where organization_id = v_invitation.organization_id and user_id = v_user_id;
  end if;

  insert into public.member_roles (member_id, role_id)
  values (v_member_id, v_invitation.role_id)
  on conflict do nothing;

  update public.invitations
  set status = 'accepted', accepted_at = now(), accepted_by = v_user_id
  where id = v_invitation.id;

  perform public.log_audit_event(
    v_invitation.organization_id, 'invitation.accepted', 'invitation', v_invitation.id::text,
    format('%s joined the organization', v_user_email)
  );

  return v_invitation.organization_id;
end;
$fn$;

-- --- Policies --------------------------------------------------------------
-- Replaced because every one of these referenced `rank > 0` (a stand-in for
-- "the owner role") or `is_system` (a stand-in for "a role you may not
-- touch"). Both concepts are gone.

drop policy if exists "Role managers can create roles" on public.roles;
create policy "Role managers can create roles"
  on public.roles for insert to authenticated
  with check (
    public.has_org_permission(organization_id, 'roles.manage')
    -- A new role can never be created at or above its creator's authority.
    and rank > coalesce(public.my_role_rank(organization_id), 1000)
    -- is_system marks provisioning only; a client-created role is not one.
    and is_system = false
  );

drop policy if exists "Role managers can update non-owner roles" on public.roles;
drop policy if exists "Role managers can update roles below their authority" on public.roles;
create policy "Role managers can update roles below their authority"
  on public.roles for update to authenticated
  using (
    public.has_org_permission(organization_id, 'roles.manage')
    and rank > coalesce(public.my_role_rank(organization_id), 1000)
  )
  with check (
    public.has_org_permission(organization_id, 'roles.manage')
    and rank > coalesce(public.my_role_rank(organization_id), 1000)
  );

drop policy if exists "Role managers can delete custom roles" on public.roles;
drop policy if exists "Role managers can delete roles below their authority" on public.roles;
create policy "Role managers can delete roles below their authority"
  on public.roles for delete to authenticated
  using (
    public.has_org_permission(organization_id, 'roles.manage')
    and rank > coalesce(public.my_role_rank(organization_id), 1000)
  );

drop policy if exists "Role managers can grant permissions" on public.role_permissions;
create policy "Role managers can grant permissions"
  on public.role_permissions for insert to authenticated
  with check (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and public.has_org_permission(r.organization_id, 'roles.manage')
        and r.rank > coalesce(public.my_role_rank(r.organization_id), 1000)
        -- You cannot delegate a capability you do not hold yourself.
        and public.has_org_permission(r.organization_id, role_permissions.permission_key)
    )
  );

drop policy if exists "Role managers can revoke permissions" on public.role_permissions;
create policy "Role managers can revoke permissions"
  on public.role_permissions for delete to authenticated
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and public.has_org_permission(r.organization_id, 'roles.manage')
        and r.rank > coalesce(public.my_role_rank(r.organization_id), 1000)
    )
  );

-- --- Shared authority check ------------------------------------------------

create or replace function public.assert_can_manage_role(p_role_id uuid)
returns public.roles
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_role       public.roles;
  v_actor_rank integer;
begin
  select * into v_role from public.roles where id = p_role_id;
  if v_role is null then
    raise exception 'Role not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_role.organization_id, 'roles.manage') then
    raise exception 'You do not have permission to manage roles'
      using errcode = 'insufficient_privilege';
  end if;

  v_actor_rank := coalesce(public.my_role_rank(v_role.organization_id), 1000);
  if v_role.rank <= v_actor_rank then
    raise exception 'You can only manage roles below your own authority'
      using errcode = 'insufficient_privilege';
  end if;

  return v_role;
end;
$fn$;

revoke execute on function public.assert_can_manage_role(uuid) from public, anon;

-- --- Role mutations --------------------------------------------------------
-- These are SECURITY DEFINER rather than plain RLS writes for two reasons:
-- every one of them must append an audit row (clients have no write policy on
-- audit_logs), and two of them enforce invariants a single policy cannot
-- express — set_role_permissions applies a diff atomically, delete_role must
-- refuse when it would strip a member of their last role.

create or replace function public.create_role(
  p_organization_id uuid,
  p_name text,
  p_description text default null,
  p_rank integer default 500
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor_rank integer;
  v_key        text;
  v_role_id    uuid;
begin
  if not public.has_org_permission(p_organization_id, 'roles.manage') then
    raise exception 'You do not have permission to manage roles'
      using errcode = 'insufficient_privilege';
  end if;

  v_actor_rank := coalesce(public.my_role_rank(p_organization_id), 1000);
  if p_rank <= v_actor_rank then
    raise exception 'You cannot create a role at or above your own authority'
      using errcode = 'insufficient_privilege';
  end if;

  -- The key is an internal slug only. Nothing reads it to decide authority,
  -- and it is never shown to the user, so a collision-proof suffix is fine.
  v_key := lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]+', '_', 'g'));
  v_key := regexp_replace(v_key, '^[^a-z]+', '');
  if v_key = '' then
    v_key := 'role';
  end if;
  v_key := left(v_key, 20) || '_' || substr(md5(gen_random_uuid()::text), 1, 8);

  insert into public.roles (organization_id, key, name, description, rank, is_system, created_by)
  values (p_organization_id, v_key, p_name, p_description, p_rank, false, (select auth.uid()))
  returning id into v_role_id;

  perform public.log_audit_event(
    p_organization_id, 'role.created', 'role', v_role_id::text,
    format('Role %s created', p_name),
    jsonb_build_object('name', p_name, 'rank', p_rank)
  );

  return v_role_id;
end;
$fn$;

create or replace function public.update_role(
  p_role_id uuid,
  p_name text,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_role public.roles;
begin
  v_role := public.assert_can_manage_role(p_role_id);

  update public.roles
  set name = p_name, description = p_description
  where id = p_role_id;

  perform public.log_audit_event(
    v_role.organization_id, 'role.updated', 'role', p_role_id::text,
    format('Role renamed to %s', p_name),
    jsonb_build_object('before', jsonb_build_object('name', v_role.name),
                       'after',  jsonb_build_object('name', p_name))
  );
end;
$fn$;

create or replace function public.set_role_rank(p_role_id uuid, p_rank integer)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_role       public.roles;
  v_actor_rank integer;
begin
  v_role := public.assert_can_manage_role(p_role_id);

  v_actor_rank := coalesce(public.my_role_rank(v_role.organization_id), 1000);
  if p_rank <= v_actor_rank then
    raise exception 'You cannot move a role to or above your own authority'
      using errcode = 'insufficient_privilege';
  end if;

  update public.roles set rank = p_rank where id = p_role_id;

  perform public.log_audit_event(
    v_role.organization_id, 'role.updated', 'role', p_role_id::text,
    format('Role %s moved to rank %s', v_role.name, p_rank),
    jsonb_build_object('before', jsonb_build_object('rank', v_role.rank),
                       'after',  jsonb_build_object('rank', p_rank))
  );
end;
$fn$;

create or replace function public.delete_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_role     public.roles;
  v_stranded integer;
begin
  v_role := public.assert_can_manage_role(p_role_id);

  -- Refuse rather than silently strip someone of their only role. The
  -- keep-one trigger would catch this anyway; raising here says why.
  select count(*) into v_stranded
  from public.member_roles mr
  where mr.role_id = p_role_id
    and not exists (
      select 1 from public.member_roles other
      where other.member_id = mr.member_id and other.role_id <> p_role_id
    );

  if v_stranded > 0 then
    raise exception
      'Cannot delete this role: % member(s) hold no other role. Assign them another role first.',
      v_stranded
      using errcode = 'check_violation';
  end if;

  perform public.log_audit_event(
    v_role.organization_id, 'role.deleted', 'role', p_role_id::text,
    format('Role %s deleted', v_role.name),
    jsonb_build_object('name', v_role.name, 'rank', v_role.rank)
  );

  delete from public.roles where id = p_role_id;
end;
$fn$;

create or replace function public.set_role_permissions(p_role_id uuid, p_permission_keys text[])
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_role    public.roles;
  v_key     text;
  v_before  text[];
begin
  v_role := public.assert_can_manage_role(p_role_id);

  -- Delegation safety: every key being added must be one the caller holds.
  -- Checked before anything is written so the whole edit is atomic.
  foreach v_key in array coalesce(p_permission_keys, array[]::text[]) loop
    if not exists (select 1 from public.permissions where key = v_key) then
      raise exception 'Unknown permission %', v_key using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.role_permissions
                   where role_id = p_role_id and permission_key = v_key)
       and not public.has_org_permission(v_role.organization_id, v_key) then
      raise exception 'You cannot grant a permission you do not hold: %', v_key
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  select array_agg(permission_key order by permission_key) into v_before
  from public.role_permissions where role_id = p_role_id;

  delete from public.role_permissions
  where role_id = p_role_id
    and permission_key <> all (coalesce(p_permission_keys, array[]::text[]));

  insert into public.role_permissions (role_id, permission_key)
  select p_role_id, k from unnest(coalesce(p_permission_keys, array[]::text[])) as k
  on conflict do nothing;

  perform public.log_audit_event(
    v_role.organization_id, 'role.permissions_changed', 'role', p_role_id::text,
    format('Permissions updated for %s', v_role.name),
    jsonb_build_object('before', to_jsonb(coalesce(v_before, array[]::text[])),
                       'after',  to_jsonb(coalesce(p_permission_keys, array[]::text[])))
  );
end;
$fn$;

-- --- Member role assignment ------------------------------------------------

create or replace function public.assign_role_to_member(p_member_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member      public.organization_members;
  v_role        public.roles;
  v_actor_rank  integer;
  v_target_rank integer;
  v_owner_id    uuid;
begin
  select * into v_member from public.organization_members where id = p_member_id;
  if v_member is null then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  select * into v_role from public.roles where id = p_role_id;
  if v_role is null or v_role.organization_id <> v_member.organization_id then
    raise exception 'Role does not belong to that member''s organization'
      using errcode = 'check_violation';
  end if;

  if not public.has_org_permission(v_member.organization_id, 'members.manage') then
    raise exception 'You do not have permission to manage members'
      using errcode = 'insufficient_privilege';
  end if;

  v_actor_rank := coalesce(public.my_role_rank(v_member.organization_id), 1000);

  select o.owner_id into v_owner_id
  from public.organizations o where o.id = v_member.organization_id;

  if v_member.user_id = v_owner_id then
    v_target_rank := -1;
  else
    select min(r.rank) into v_target_rank
    from public.member_roles mr join public.roles r on r.id = mr.role_id
    where mr.member_id = p_member_id;
  end if;

  -- You may not hand out authority you do not have, nor touch a peer.
  if v_actor_rank > -1 then
    if v_role.rank <= v_actor_rank then
      raise exception 'You cannot assign a role at or above your own authority'
        using errcode = 'insufficient_privilege';
    end if;
    if v_member.user_id <> (select auth.uid())
       and (v_target_rank is null or v_target_rank <= v_actor_rank) then
      raise exception 'You cannot manage a member whose authority is at or above your own'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into public.member_roles (member_id, role_id, assigned_by)
  values (p_member_id, p_role_id, (select auth.uid()))
  on conflict do nothing;

  perform public.log_audit_event(
    v_member.organization_id, 'member.role_changed', 'member', p_member_id::text,
    format('Role %s assigned', v_role.name),
    jsonb_build_object('assigned', v_role.name, 'role_id', p_role_id)
  );
end;
$fn$;

create or replace function public.unassign_role_from_member(p_member_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_member      public.organization_members;
  v_role        public.roles;
  v_actor_rank  integer;
  v_target_rank integer;
  v_owner_id    uuid;
  v_remaining   integer;
begin
  select * into v_member from public.organization_members where id = p_member_id;
  if v_member is null then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  select * into v_role from public.roles where id = p_role_id;
  if v_role is null then
    raise exception 'Role not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_member.organization_id, 'members.manage') then
    raise exception 'You do not have permission to manage members'
      using errcode = 'insufficient_privilege';
  end if;

  v_actor_rank := coalesce(public.my_role_rank(v_member.organization_id), 1000);

  select o.owner_id into v_owner_id
  from public.organizations o where o.id = v_member.organization_id;

  if v_member.user_id = v_owner_id then
    v_target_rank := -1;
  else
    select min(r.rank) into v_target_rank
    from public.member_roles mr join public.roles r on r.id = mr.role_id
    where mr.member_id = p_member_id;
  end if;

  if v_actor_rank > -1 then
    if v_role.rank <= v_actor_rank then
      raise exception 'You cannot remove a role at or above your own authority'
        using errcode = 'insufficient_privilege';
    end if;
    if v_member.user_id <> (select auth.uid())
       and (v_target_rank is null or v_target_rank <= v_actor_rank) then
      raise exception 'You cannot manage a member whose authority is at or above your own'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  select count(*) into v_remaining
  from public.member_roles where member_id = p_member_id and role_id <> p_role_id;

  if v_remaining = 0 then
    raise exception 'A member must keep at least one role'
      using errcode = 'check_violation';
  end if;

  delete from public.member_roles where member_id = p_member_id and role_id = p_role_id;

  perform public.log_audit_event(
    v_member.organization_id, 'member.role_changed', 'member', p_member_id::text,
    format('Role %s removed', v_role.name),
    jsonb_build_object('removed', v_role.name, 'role_id', p_role_id)
  );
end;
$fn$;

-- --- Grants ----------------------------------------------------------------
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, so each one is
-- closed before being reopened to authenticated callers only.

revoke execute on function public.create_role(uuid, text, text, integer)       from public, anon;
revoke execute on function public.update_role(uuid, text, text)                from public, anon;
revoke execute on function public.set_role_rank(uuid, integer)                 from public, anon;
revoke execute on function public.delete_role(uuid)                            from public, anon;
revoke execute on function public.set_role_permissions(uuid, text[])           from public, anon;
revoke execute on function public.assign_role_to_member(uuid, uuid)            from public, anon;
revoke execute on function public.unassign_role_from_member(uuid, uuid)        from public, anon;

grant execute on function public.create_role(uuid, text, text, integer)        to authenticated;
grant execute on function public.update_role(uuid, text, text)                 to authenticated;
grant execute on function public.set_role_rank(uuid, integer)                  to authenticated;
grant execute on function public.delete_role(uuid)                             to authenticated;
grant execute on function public.set_role_permissions(uuid, text[])            to authenticated;
grant execute on function public.assign_role_to_member(uuid, uuid)             to authenticated;
grant execute on function public.unassign_role_from_member(uuid, uuid)         to authenticated;

-- Re-close the helpers this migration replaced: CREATE OR REPLACE resets the
-- default PUBLIC grant that 20250901000400 previously revoked.
revoke execute on function public.has_org_permission(uuid, text) from public, anon;
revoke execute on function public.my_role_rank(uuid)             from public, anon;
revoke execute on function public.my_permissions(uuid)           from public, anon;
grant execute on function public.has_org_permission(uuid, text)  to authenticated;
grant execute on function public.my_role_rank(uuid)              to authenticated;
grant execute on function public.my_permissions(uuid)            to authenticated;
