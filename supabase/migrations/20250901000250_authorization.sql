-- ===========================================================================
-- LFG HQ · Phase 1 · Authorization primitives
--
-- Every function here is SECURITY DEFINER with a pinned empty search_path.
-- They exist so RLS policies can ask "is this user a member?" / "does this
-- user hold this permission?" without the policy re-entering the very table
-- it is protecting (which would recurse infinitely).
--
-- Because they are SECURITY DEFINER they are also the only sanctioned way to
-- perform privileged writes: EXECUTE is revoked from PUBLIC and granted
-- explicitly to `authenticated`.
-- ===========================================================================

-- --- Read-side helpers ----------------------------------------------------

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$fn$;

comment on function public.is_org_member is
  'True when the current user is an active member of the organization. Used by RLS.';

create or replace function public.has_org_permission(p_organization_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.organization_members m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and rp.permission_key = p_permission
  );
$fn$;

comment on function public.has_org_permission is
  'Authoritative permission check. Frontend checks mirror this; they never replace it.';

create or replace function public.my_role_rank(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.rank
  from public.organization_members m
  join public.roles r on r.id = m.role_id
  where m.organization_id = p_organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active';
$fn$;

create or replace function public.shares_organization_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = p_user_id
  );
$fn$;

comment on function public.shares_organization_with is
  'True when the current user and the target user share at least one organization. '
  'Gates profile visibility so members cannot enumerate unrelated users.';

-- Convenience for the client: one round trip for the full permission set.
create or replace function public.my_permissions(p_organization_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $fn$
  select distinct rp.permission_key
  from public.organization_members m
  join public.role_permissions rp on rp.role_id = m.role_id
  where m.organization_id = p_organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active';
$fn$;

-- --- Audit ----------------------------------------------------------------

create or replace function public.log_audit_event(
  p_organization_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_summary text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $fn$
  insert into public.audit_logs
    (organization_id, actor_id, action, entity_type, entity_id, summary, metadata)
  values
    (p_organization_id, (select auth.uid()), p_action, p_entity_type, p_entity_id,
     p_summary, coalesce(p_metadata, '{}'::jsonb));
$fn$;

-- --- New auth user -> profile --------------------------------------------
-- Runs as the auth system, not as a client, so it is exempt from RLS.

create or replace function public.tg_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, email, full_name, display_name, avatar_url)
  values (
    new.id,
    lower(btrim(new.email)),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_handle_new_user();

-- Keep the profile email in step if the account email changes.
create or replace function public.tg_sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = lower(btrim(new.email)) where id = new.id;
  end if;
  return new;
end;
$fn$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.tg_sync_user_email();

-- --- Privilege-escalation guard ------------------------------------------
-- Enforced in the database, so it holds regardless of which client is talking.

create or replace function public.tg_guard_member_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor_rank    integer;
  v_target_rank   integer;
  v_new_rank      integer;
  v_owner_count   integer;
  v_target        public.organization_members;
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

  select r.rank into v_target_rank
  from public.roles r where r.id = old.role_id;

  select public.my_role_rank(old.organization_id) into v_actor_rank;

  if v_actor_rank is null then
    raise exception 'Not a member of this organization' using errcode = 'insufficient_privilege';
  end if;

  -- Owners (rank 0) may act on anyone. Everyone else may only act on members
  -- with strictly less authority than themselves, which also stops peers from
  -- demoting each other. Acting on yourself is always allowed here; the
  -- last-owner check below still applies.
  if old.user_id <> (select auth.uid())
     and v_actor_rank > 0
     and v_target_rank <= v_actor_rank then
    raise exception 'Cannot modify a member whose role ranks at or above your own'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' and new.role_id is distinct from old.role_id then
    select r.rank into v_new_rank from public.roles r where r.id = new.role_id;
    -- You may not grant authority you do not have.
    if v_new_rank < v_actor_rank then
      raise exception 'Cannot grant a role with more authority than your own'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- An organization must always retain at least one active owner.
  if v_target_rank = 0 then
    if tg_op = 'DELETE'
       or (tg_op = 'UPDATE' and (new.role_id is distinct from old.role_id
                                 or new.status is distinct from old.status)) then
      select count(*) into v_owner_count
      from public.organization_members m
      join public.roles r on r.id = m.role_id
      where m.organization_id = old.organization_id
        and r.rank = 0
        and m.status = 'active'
        and m.id <> old.id;

      if v_owner_count = 0 then
        raise exception 'The organization must keep at least one active owner'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return v_target;
end;
$fn$;

create trigger organization_members_guard
  before update or delete on public.organization_members
  for each row execute function public.tg_guard_member_changes();

-- --- Organization bootstrap ----------------------------------------------
-- Creating an organization is not a self-serve action. This runs from the
-- seed script or from an operator session using the service role.

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
  v_org_id  uuid;
  v_role    record;
  v_owner_role_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = p_owner_id) then
    raise exception 'Owner profile % does not exist', p_owner_id;
  end if;

  insert into public.organizations (slug, name, tagline, timezone)
  values (p_slug, p_name, p_tagline, p_timezone)
  returning id into v_org_id;

  -- Materialise the role templates for this organization so it can diverge.
  for v_role in select * from public.role_templates order by rank loop
    insert into public.roles (organization_id, key, name, description, rank, is_system)
    values (v_org_id, v_role.key, v_role.name, v_role.description, v_role.rank, true);
  end loop;

  insert into public.role_permissions (role_id, permission_key)
  select r.id, tp.permission_key
  from public.roles r
  join public.role_template_permissions tp on tp.role_template_key = r.key
  where r.organization_id = v_org_id;

  select id into v_owner_role_id
  from public.roles
  where organization_id = v_org_id and key = 'owner';

  insert into public.organization_members (organization_id, user_id, role_id, status)
  values (v_org_id, p_owner_id, v_owner_role_id, 'active');

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, summary)
  values (v_org_id, p_owner_id, 'organization.created', 'organization', v_org_id::text,
          format('Organization %s created', p_name));

  return v_org_id;
end;
$fn$;

-- --- Invitations ----------------------------------------------------------

create or replace function public.hash_invitation_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$fn$;

-- Called by the invite Edge Function *as the inviting user*, so the permission
-- check and the audit trail both reflect a real actor. Returns the raw token
-- exactly once; only its hash is persisted.
create or replace function public.create_invitation(
  p_organization_id uuid,
  p_email text,
  p_role_id uuid,
  p_token text,
  p_expires_in_days integer default 7
)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_role         public.roles;
  v_actor_rank   integer;
  v_invitation   public.invitations;
  v_email        text := lower(btrim(p_email));
begin
  if not public.has_org_permission(p_organization_id, 'members.invite') then
    raise exception 'You do not have permission to invite members'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_role from public.roles
  where id = p_role_id and organization_id = p_organization_id;

  if v_role is null then
    raise exception 'Unknown role for this organization' using errcode = 'check_violation';
  end if;

  v_actor_rank := public.my_role_rank(p_organization_id);
  if v_role.rank < v_actor_rank then
    raise exception 'Cannot invite someone at a higher role than your own'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = p_organization_id and lower(p.email) = v_email
  ) then
    raise exception 'That person is already a member of this organization'
      using errcode = 'unique_violation';
  end if;

  -- Supersede any live invitation for the same address.
  update public.invitations
  set status = 'revoked'
  where organization_id = p_organization_id
    and lower(email) = v_email
    and status = 'pending';

  insert into public.invitations
    (organization_id, email, role_id, invited_by, token_hash, expires_at)
  values
    (p_organization_id, v_email, p_role_id, (select auth.uid()),
     public.hash_invitation_token(p_token),
     now() + make_interval(days => greatest(1, least(p_expires_in_days, 30))))
  returning * into v_invitation;

  perform public.log_audit_event(
    p_organization_id, 'invitation.created', 'invitation', v_invitation.id::text,
    format('Invited %s as %s', v_email, v_role.name),
    jsonb_build_object('email', v_email, 'role', v_role.key)
  );

  return v_invitation;
end;
$fn$;

-- Called by the invited user after they authenticate. The token alone is not
-- enough: the signed-in address must match the invited address.
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
  on conflict (organization_id, user_id) do nothing;

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

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_invitation public.invitations;
begin
  select * into v_invitation from public.invitations where id = p_invitation_id;
  if v_invitation is null then
    raise exception 'Invitation not found' using errcode = 'no_data_found';
  end if;

  if not public.has_org_permission(v_invitation.organization_id, 'members.invite') then
    raise exception 'You do not have permission to revoke invitations'
      using errcode = 'insufficient_privilege';
  end if;

  update public.invitations set status = 'revoked'
  where id = p_invitation_id and status = 'pending';

  perform public.log_audit_event(
    v_invitation.organization_id, 'invitation.revoked', 'invitation', p_invitation_id::text,
    format('Invitation to %s revoked', v_invitation.email)
  );
end;
$fn$;

-- --- Execution grants -----------------------------------------------------
-- Surgical rather than a blanket REVOKE across the schema: the auth trigger
-- functions are fired by supabase_auth_admin and must keep their privileges.

revoke execute on function public.bootstrap_organization(text, text, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.log_audit_event(uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.create_invitation(uuid, text, uuid, text, integer)
  from public, anon;
revoke execute on function public.accept_invitation(text)   from public, anon;
revoke execute on function public.revoke_invitation(uuid)   from public, anon;
revoke execute on function public.hash_invitation_token(text) from public, anon, authenticated;

grant execute on function public.is_org_member(uuid)                       to authenticated;
grant execute on function public.has_org_permission(uuid, text)            to authenticated;
grant execute on function public.my_role_rank(uuid)                        to authenticated;
grant execute on function public.shares_organization_with(uuid)            to authenticated;
grant execute on function public.my_permissions(uuid)                      to authenticated;
grant execute on function public.accept_invitation(text)                   to authenticated;
grant execute on function public.revoke_invitation(uuid)                   to authenticated;
grant execute on function public.create_invitation(uuid, text, uuid, text, integer)
                                                                           to authenticated;

-- bootstrap_organization and log_audit_event are deliberately NOT granted to
-- `authenticated`: organizations are provisioned by an operator, and audit
-- rows are only ever written from inside other SECURITY DEFINER routines.
