-- ===========================================================================
-- LFG HQ · Phase 2 · C2 · Notification foundation
--
-- One table, addressed to one person. Deliberately shaped like `audit_logs`
-- (entity_type / entity_id / summary / metadata) so the two read alike and
-- nobody has to learn a second vocabulary for "something happened to X".
--
-- `type` is text with no CHECK. An enum needs a migration for every new value
-- and cannot be extended and used in the same transaction — exactly the wall
-- B2 hit adding 'banned'. Thread replies, direct messages and calendar
-- reminders will each need code, but none of them will need this file.
--
-- There is NO INSERT policy. Notifications are written only by SECURITY
-- DEFINER code, which is what stops a client manufacturing a notification for
-- somebody else — or manufacturing thousands for themselves.
--
-- No retention job. Six people generating a handful of mentions a day is not
-- a storage problem, and the partial index below makes a future prune cheap.
--
-- Additive only.
-- ===========================================================================

create table public.notifications (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recipient_id    uuid not null references public.profiles (id) on delete cascade,

  -- 'mention' today. Open on purpose.
  type            text not null,

  entity_type     text not null,
  entity_id       text not null,
  actor_id        uuid references public.profiles (id) on delete set null,
  summary         text not null,
  metadata        jsonb not null default '{}'::jsonb,

  read_at         timestamptz,
  created_at      timestamptz not null default now(),

  constraint notifications_type_length check (char_length(type) between 1 and 40),
  constraint notifications_summary_length check (char_length(summary) between 1 and 300)
);

comment on table public.notifications is
  'Per-recipient notifications. Readable only by their recipient and writable only by SECURITY DEFINER code.';

create index notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

-- The badge asks one question — how many are unread — and this answers it
-- without touching the read ones.
create index notifications_unread_idx
  on public.notifications (recipient_id)
  where read_at is null;

-- --- Only `read_at` is yours to change -------------------------------------

create or replace function public.tg_protect_notification_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.recipient_id is distinct from old.recipient_id
     or new.type is distinct from old.type
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.actor_id is distinct from old.actor_id
     or new.summary is distinct from old.summary
     or new.metadata is distinct from old.metadata
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the read state of a notification may be changed'
      using errcode = 'insufficient_privilege';
  end if;

  -- Stamped here so a client cannot claim it read something in the future,
  -- and so unreading is a real operation rather than a forged timestamp.
  if new.read_at is not null and old.read_at is null then
    new.read_at := now();
  end if;

  return new;
end;
$fn$;

create trigger notifications_protect_columns
  before update on public.notifications
  for each row execute function public.tg_protect_notification_columns();

-- --- RLS -------------------------------------------------------------------

alter table public.notifications enable row level security;

create policy "Yours alone"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));

create policy "You may mark your own as read"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- No INSERT policy and no DELETE policy, on purpose.

revoke all on public.notifications from anon;
grant select, update on public.notifications to authenticated;

-- --- Marking read ----------------------------------------------------------

create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns integer
language plpgsql
-- INVOKER: the policy above is the authorization, so this cannot become a way
-- to mark somebody else's notifications read.
security invoker
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  update public.notifications
  set read_at = now()
  where read_at is null
    and (p_ids is null or id = any (p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

comment on function public.mark_notifications_read is
  'Marks the caller''s unread notifications read; NULL means all of them. SECURITY INVOKER, so RLS decides whose.';

revoke execute on function public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- --- Realtime --------------------------------------------------------------
-- RLS is evaluated per subscriber, so a client is only ever woken by its own.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
