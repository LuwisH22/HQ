-- ===========================================================================
-- LFG HQ · Phase 1.5 · B3 · Channel schema
--
-- Text channels, optional categories, and per-role permission overrides.
-- No messages: B3 is the container, Phase 2 fills it.
--
-- A note on the override table, because it is the security-critical part.
-- An override row is scoped to ONE channel. Nothing in this schema, and
-- nothing in the resolver that reads it, can turn a channel-local ALLOW into
-- an organization-wide grant: `has_org_permission` and `my_permissions` never
-- read this table at all. The separation is structural, not a matter of
-- careful querying.
--
-- Overrides are also restricted to a safe subset by CHECK constraint. There is
-- deliberately no way to override `organization.*`, `roles.*` or `members.*`
-- per channel — a channel is not a place from which to grant ownership
-- transfer or the ability to ban.
--
-- Additive only.
-- ===========================================================================

create type public.override_effect as enum ('allow', 'deny');

comment on type public.override_effect is
  'A channel override either allows or denies. The absence of a row means inherit.';

-- --- Categories ------------------------------------------------------------

create table public.channel_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  position         integer not null default 0,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint channel_categories_name_length check (char_length(name) between 1 and 40)
);

create index channel_categories_org_position_idx
  on public.channel_categories (organization_id, position);

create trigger channel_categories_set_updated_at
  before update on public.channel_categories
  for each row execute function public.tg_set_updated_at();

-- --- Channels --------------------------------------------------------------

create table public.channels (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- NULL is a real state: an uncategorised channel, not a placeholder category.
  category_id      uuid references public.channel_categories (id) on delete set null,
  key              text not null,
  name             text not null,
  topic            text,
  -- Only text for now. Voice and video would extend this enum-like column, and
  -- the column exists so that addition does not require a table rewrite.
  type             text not null default 'text',
  position         integer not null default 0,
  -- Private inverts the default for channels.view: invisible unless a role the
  -- member holds has an explicit ALLOW.
  is_private       boolean not null default false,
  -- Archiving is the reversible, normal way to retire a channel. Hard deletion
  -- is a separate, heavier operation.
  archived_at      timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint channels_key_format check (key ~ '^[a-z][a-z0-9_-]{1,38}$'),
  constraint channels_name_length check (char_length(name) between 1 and 40),
  constraint channels_topic_length check (topic is null or char_length(topic) <= 200),
  constraint channels_type_check check (type in ('text'))
);

create unique index channels_org_key_idx on public.channels (organization_id, key);
create index channels_org_position_idx on public.channels (organization_id, position);
create index channels_category_idx on public.channels (category_id);
-- The sidebar only ever lists live channels.
create index channels_live_idx on public.channels (organization_id) where archived_at is null;

create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function public.tg_set_updated_at();

comment on table public.channels is
  'Text channels. Phase 2 attaches messages via a channel_id FK with ON DELETE CASCADE, which is why hard deletion is gated behind its own permission.';

-- A category may only hold channels from its own organization.
create or replace function public.tg_channel_category_org_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_category_org uuid;
begin
  if new.category_id is null then
    return new;
  end if;

  select organization_id into v_category_org
  from public.channel_categories where id = new.category_id;

  if v_category_org is null or v_category_org <> new.organization_id then
    raise exception 'That category belongs to a different organization'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

create trigger channels_category_org_check
  before insert or update of category_id, organization_id on public.channels
  for each row execute function public.tg_channel_category_org_match();

-- --- Overrides -------------------------------------------------------------

create table public.channel_permission_overrides (
  channel_id      uuid not null references public.channels (id) on delete cascade,
  role_id         uuid not null references public.roles (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  effect          public.override_effect not null,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (channel_id, role_id, permission_key),

  -- The safe subset. A channel decides who may see it and who may speak in it;
  -- it does not decide who may run the organization.
  constraint channel_overrides_permission_subset check (
    permission_key in ('channels.view', 'messages.send', 'messages.pin', 'messages.moderate')
  )
);

create index channel_overrides_role_idx on public.channel_permission_overrides (role_id);

create trigger channel_overrides_set_updated_at
  before update on public.channel_permission_overrides
  for each row execute function public.tg_set_updated_at();

comment on table public.channel_permission_overrides is
  'Per-channel, per-role Allow/Deny. An absent row means inherit. Scoped to one channel: never consulted by has_org_permission.';

-- A role may only be overridden inside its own organization's channel.
create or replace function public.tg_channel_override_org_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_channel_org uuid;
  v_role_org    uuid;
begin
  select organization_id into v_channel_org from public.channels where id = new.channel_id;
  select organization_id into v_role_org from public.roles where id = new.role_id;

  if v_channel_org is null or v_role_org is null or v_channel_org <> v_role_org then
    raise exception 'That role belongs to a different organization than the channel'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

create trigger channel_overrides_org_check
  before insert or update on public.channel_permission_overrides
  for each row execute function public.tg_channel_override_org_match();
