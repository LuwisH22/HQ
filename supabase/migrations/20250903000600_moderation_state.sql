-- ===========================================================================
-- LFG HQ · Phase 1.5 · B2 · Moderation state and history
--
-- Suspension is stored, never scheduled. The membership row keeps its
-- `suspended` status and an expiry; whether that suspension is still in force
-- is derived at read time by is_effectively_active() in the next migration.
-- No cron, no background job, and no window where a row says one thing and
-- reality says another.
--
-- `moderation_actions` is the append-only history. Like audit_logs, clients
-- get a read policy and nothing else — the routines in 000900 are the only
-- writers.
--
-- Additive only.
-- ===========================================================================

alter table public.organization_members
  add column suspended_until   timestamptz,
  add column moderation_reason text,
  add column moderated_by      uuid references public.profiles (id) on delete set null,
  add column moderated_at      timestamptz;

comment on column public.organization_members.suspended_until is
  'When a suspension lapses. NULL with status=suspended means indefinite. Never consulted for status=banned.';

-- Finding the suspensions that have lapsed is the one time-based query this
-- feature makes, so it gets an index.
create index organization_members_suspended_until_idx
  on public.organization_members (suspended_until)
  where suspended_until is not null;

-- --- History ---------------------------------------------------------------

create table public.moderation_actions (
  id                bigint generated always as identity primary key,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  target_member_id  uuid references public.organization_members (id) on delete set null,
  -- Kept separately so the history survives the membership being deleted.
  target_user_id    uuid not null references public.profiles (id) on delete cascade,
  actor_id          uuid references public.profiles (id) on delete set null,
  action            text not null,
  reason            text,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),

  constraint moderation_actions_action_check
    check (action in ('suspend', 'unsuspend', 'ban', 'unban')),
  constraint moderation_actions_reason_length
    check (reason is null or char_length(reason) <= 500)
);

comment on table public.moderation_actions is
  'Append-only moderation history. Written only by SECURITY DEFINER routines; clients have no write policy.';

create index moderation_actions_org_created_idx
  on public.moderation_actions (organization_id, created_at desc);
create index moderation_actions_target_idx
  on public.moderation_actions (target_user_id, created_at desc);

-- --- RLS -------------------------------------------------------------------

alter table public.moderation_actions enable row level security;

-- Readable by anyone who may act on members, plus the person it is about:
-- someone who has been suspended should be able to see why.
create policy "Moderators and the subject can read moderation history"
  on public.moderation_actions for select to authenticated
  using (
    target_user_id = (select auth.uid())
    or public.has_org_permission(organization_id, 'members.suspend')
    or public.has_org_permission(organization_id, 'members.ban')
    or public.has_org_permission(organization_id, 'audit.read')
  );

-- Deliberately no INSERT/UPDATE/DELETE policy: history cannot be forged,
-- edited or erased from a client.

revoke all on public.moderation_actions from anon;
grant select on public.moderation_actions to authenticated;
