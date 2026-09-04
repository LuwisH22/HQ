-- ===========================================================================
-- LFG HQ · Phase 1 · Core schema
--
-- Organizations, profiles, roles, permissions and membership.
-- RLS for every table here is defined in 20250901000300_rls_policies.sql.
-- ===========================================================================

-- --- Enums ----------------------------------------------------------------

create type public.member_status as enum ('active', 'suspended');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

-- --- Shared trigger: keep updated_at honest -------------------------------

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

comment on function public.tg_set_updated_at is
  'BEFORE UPDATE trigger that stamps updated_at, so clients cannot forge it.';

-- --- Organizations --------------------------------------------------------

create table public.organizations (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null,
  name         text not null,
  tagline      text,
  logo_url     text,
  timezone     text not null default 'UTC',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint organizations_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  constraint organizations_name_length check (char_length(name) between 2 and 80)
);

create unique index organizations_slug_key on public.organizations (slug);
create index organizations_active_idx on public.organizations (id) where deleted_at is null;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.tg_set_updated_at();

comment on table public.organizations is
  'The esports organizations this HQ hosts. Soft-deleted via deleted_at.';

-- --- Profiles (1:1 with auth.users) ---------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text,
  display_name  text,
  avatar_url    text,
  title         text,
  bio           text,
  timezone      text not null default 'UTC',
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint profiles_email_format check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint profiles_display_name_length check (
    display_name is null or char_length(display_name) between 1 and 40
  ),
  constraint profiles_full_name_length check (
    full_name is null or char_length(full_name) between 1 and 80
  ),
  constraint profiles_bio_length check (bio is null or char_length(bio) <= 500)
);

create unique index profiles_email_key on public.profiles (lower(email));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

comment on table public.profiles is
  'Application-visible user data. auth.users stays private to the auth schema.';

-- Normalise email on the way in so the unique index and lookups agree.
create or replace function public.tg_normalize_email()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$fn$;

create trigger profiles_normalize_email
  before insert or update of email on public.profiles
  for each row execute function public.tg_normalize_email();

-- --- Permission catalogue -------------------------------------------------
-- Static, global, readable by any authenticated user. Permissions are *data*:
-- neither the UI nor the RLS policies hardcode a role name to decide access.

create table public.permissions (
  key          text primary key,
  category     text not null,
  label        text not null,
  description  text,
  sort_order   integer not null default 100,

  constraint permissions_key_format check (key ~ '^[a-z_]+\.[a-z_]+$')
);

comment on table public.permissions is
  'Catalogue of every capability the product understands. Roles are built from these.';

-- --- Roles (per organization, so each org can tune its own permissions) ----

create table public.roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  key              text not null,
  name             text not null,
  description      text,
  -- Lower rank = more authority. Used to stop privilege escalation.
  rank             integer not null,
  is_system        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint roles_key_format check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint roles_rank_range check (rank between 0 and 1000),
  constraint roles_name_length check (char_length(name) between 2 and 40)
);

create unique index roles_org_key_idx on public.roles (organization_id, key);
create index roles_organization_idx on public.roles (organization_id);

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function public.tg_set_updated_at();

comment on column public.roles.rank is
  'Authority ordering: 0 is the owner. A member can never grant a role ranked above their own.';

create table public.role_permissions (
  role_id         uuid not null references public.roles (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  created_at      timestamptz not null default now(),

  primary key (role_id, permission_key)
);

create index role_permissions_permission_idx on public.role_permissions (permission_key);

-- --- Membership -----------------------------------------------------------

create table public.organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role_id          uuid not null references public.roles (id) on delete restrict,
  status           public.member_status not null default 'active',
  joined_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index organization_members_org_user_idx
  on public.organization_members (organization_id, user_id);
-- Hot paths: "which orgs am I in?" and "who is in this org?"
create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_org_status_idx
  on public.organization_members (organization_id, status);
create index organization_members_role_idx on public.organization_members (role_id);

create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function public.tg_set_updated_at();

-- A role may only be used inside its own organization.
create or replace function public.tg_member_role_matches_org()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_role_org uuid;
begin
  select organization_id into v_role_org from public.roles where id = new.role_id;
  if v_role_org is null or v_role_org <> new.organization_id then
    raise exception 'Role % does not belong to organization %', new.role_id, new.organization_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

create trigger organization_members_role_org_check
  before insert or update of role_id, organization_id on public.organization_members
  for each row execute function public.tg_member_role_matches_org();

-- --- Invitations ----------------------------------------------------------
-- The raw token is emailed and never stored; only its SHA-256 digest lives here.

create table public.invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  email            text not null,
  role_id          uuid not null references public.roles (id) on delete restrict,
  invited_by       uuid references public.profiles (id) on delete set null,
  token_hash       text not null,
  status           public.invitation_status not null default 'pending',
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint invitations_email_format check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

create unique index invitations_token_hash_idx on public.invitations (token_hash);
-- At most one live invitation per address per organization.
create unique index invitations_one_pending_per_email_idx
  on public.invitations (organization_id, lower(email))
  where status = 'pending';
create index invitations_org_status_idx on public.invitations (organization_id, status);

create trigger invitations_set_updated_at
  before update on public.invitations
  for each row execute function public.tg_set_updated_at();

create trigger invitations_normalize_email
  before insert or update of email on public.invitations
  for each row execute function public.tg_normalize_email();

-- --- Audit log ------------------------------------------------------------
-- Written only by SECURITY DEFINER routines; clients get no write policy.

create table public.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations (id) on delete cascade,
  actor_id         uuid references public.profiles (id) on delete set null,
  action           text not null,
  entity_type      text not null,
  entity_id        text,
  summary          text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index audit_logs_org_created_idx
  on public.audit_logs (organization_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

comment on table public.audit_logs is
  'Append-only record of administrative actions. Clients have no write policy.';
