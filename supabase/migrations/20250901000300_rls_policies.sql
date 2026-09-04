-- ===========================================================================
-- LFG HQ · Phase 1 · Row Level Security
--
-- Default-deny. Every table below has RLS enabled and FORCE'd, and each policy
-- routes its decision through the SECURITY DEFINER helpers so no policy ever
-- re-queries the table it protects.
--
-- Note on `to authenticated`: policies are scoped to the authenticated role so
-- an anonymous key can never satisfy them, even if a policy body were wrong.
-- ===========================================================================

alter table public.organizations         enable row level security;
alter table public.profiles              enable row level security;
alter table public.permissions           enable row level security;
alter table public.role_templates        enable row level security;
alter table public.role_template_permissions enable row level security;
alter table public.roles                 enable row level security;
alter table public.role_permissions      enable row level security;
alter table public.organization_members  enable row level security;
alter table public.invitations           enable row level security;
alter table public.audit_logs            enable row level security;

-- FORCE ROW LEVEL SECURITY is deliberately NOT used here. The authorization
-- helpers are SECURITY DEFINER precisely so they can read membership without
-- re-entering the policies that call them; forcing RLS on the owner would make
-- is_org_member() return false for everyone and lock the whole product out.
-- Client access is constrained by the `to authenticated` policies plus the
-- table grants at the bottom of this file.

-- --- organizations --------------------------------------------------------

create policy "Members can read their organizations"
  on public.organizations for select to authenticated
  using (public.is_org_member(id));

create policy "Organization managers can update their organization"
  on public.organizations for update to authenticated
  using (public.has_org_permission(id, 'organization.manage'))
  with check (public.has_org_permission(id, 'organization.manage'));

-- No INSERT or DELETE policy: organizations are provisioned by an operator
-- through bootstrap_organization(), and are retired by setting deleted_at.

-- --- profiles -------------------------------------------------------------

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Users can read profiles of people they share an organization with"
  on public.profiles for select to authenticated
  using (public.shares_organization_with(id));

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- INSERT happens in the on_auth_user_created trigger. DELETE cascades from
-- auth.users. Neither is exposed to clients.

-- --- permissions / role templates (static reference data) -----------------

create policy "Any signed-in user can read the permission catalogue"
  on public.permissions for select to authenticated
  using (true);

create policy "Any signed-in user can read role templates"
  on public.role_templates for select to authenticated
  using (true);

create policy "Any signed-in user can read role template permissions"
  on public.role_template_permissions for select to authenticated
  using (true);

-- --- roles ----------------------------------------------------------------

create policy "Members can read the roles of their organization"
  on public.roles for select to authenticated
  using (public.is_org_member(organization_id));

create policy "Role managers can create roles"
  on public.roles for insert to authenticated
  with check (
    public.has_org_permission(organization_id, 'roles.manage')
    -- A new custom role can never outrank its creator.
    and rank > coalesce(public.my_role_rank(organization_id), 1000)
    and is_system = false
  );

create policy "Role managers can update non-owner roles"
  on public.roles for update to authenticated
  using (
    public.has_org_permission(organization_id, 'roles.manage')
    and rank > 0
    and rank >= coalesce(public.my_role_rank(organization_id), 1000)
  )
  with check (
    public.has_org_permission(organization_id, 'roles.manage')
    and rank > 0
    and rank >= coalesce(public.my_role_rank(organization_id), 1000)
  );

create policy "Role managers can delete custom roles"
  on public.roles for delete to authenticated
  using (
    public.has_org_permission(organization_id, 'roles.manage')
    and is_system = false
    and rank > coalesce(public.my_role_rank(organization_id), 1000)
  );

-- --- role_permissions -----------------------------------------------------

create policy "Members can read role permissions in their organization"
  on public.role_permissions for select to authenticated
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and public.is_org_member(r.organization_id)
    )
  );

create policy "Role managers can grant permissions"
  on public.role_permissions for insert to authenticated
  with check (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and public.has_org_permission(r.organization_id, 'roles.manage')
        and r.rank > 0
        and r.rank >= coalesce(public.my_role_rank(r.organization_id), 1000)
        -- You cannot grant a permission you do not hold yourself.
        and public.has_org_permission(r.organization_id, role_permissions.permission_key)
    )
  );

create policy "Role managers can revoke permissions"
  on public.role_permissions for delete to authenticated
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and public.has_org_permission(r.organization_id, 'roles.manage')
        and r.rank > 0
        and r.rank >= coalesce(public.my_role_rank(r.organization_id), 1000)
    )
  );

-- --- organization_members -------------------------------------------------

create policy "Members can read the roster of their organization"
  on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));

create policy "Member managers can update memberships"
  on public.organization_members for update to authenticated
  using (public.has_org_permission(organization_id, 'members.manage'))
  with check (public.has_org_permission(organization_id, 'members.manage'));

create policy "Member managers can remove members"
  on public.organization_members for delete to authenticated
  using (
    public.has_org_permission(organization_id, 'members.remove')
    -- Anyone may always leave on their own.
    or user_id = (select auth.uid())
  );

-- No INSERT policy: membership is only ever created by accept_invitation()
-- or bootstrap_organization(). The rank guard trigger backs both of the
-- policies above with checks RLS alone cannot express.

-- --- invitations ----------------------------------------------------------

create policy "Inviters can read invitations for their organization"
  on public.invitations for select to authenticated
  using (public.has_org_permission(organization_id, 'members.invite'));

-- INSERT/UPDATE run through create_invitation() and revoke_invitation(), which
-- hash the token and write the audit trail. No direct client write policy.

create policy "Inviters can delete spent invitations"
  on public.invitations for delete to authenticated
  using (
    public.has_org_permission(organization_id, 'members.invite')
    and status <> 'pending'
  );

-- --- audit_logs -----------------------------------------------------------

create policy "Auditors can read the audit log"
  on public.audit_logs for select to authenticated
  using (
    organization_id is not null
    and public.has_org_permission(organization_id, 'audit.read')
  );

-- Deliberately no INSERT/UPDATE/DELETE policy: append-only, written by
-- SECURITY DEFINER routines. The log cannot be edited from a client.

-- --- Table grants ---------------------------------------------------------
-- RLS filters rows; grants decide whether the verb is reachable at all.
-- Both layers are set so that a missing policy fails closed.

grant usage on schema public to authenticated;

grant select                         on public.organizations         to authenticated;
grant update                         on public.organizations         to authenticated;
grant select, update                 on public.profiles              to authenticated;
grant select                         on public.permissions           to authenticated;
grant select                         on public.role_templates        to authenticated;
grant select                         on public.role_template_permissions to authenticated;
grant select, insert, update, delete on public.roles                 to authenticated;
grant select, insert, delete         on public.role_permissions      to authenticated;
grant select, update, delete         on public.organization_members  to authenticated;
grant select, delete                 on public.invitations           to authenticated;
grant select                         on public.audit_logs            to authenticated;

-- The anonymous role reaches nothing. Sign-in is the only door.
revoke all on all tables in schema public from anon;
