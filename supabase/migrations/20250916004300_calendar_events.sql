-- ===========================================================================
-- LFG HQ · Phase 5.1 · Calendar foundation
--
-- One table, three routines, one read policy. No UI, no recurrence, no
-- reminders, no external calendars: this is the container the calendar phase
-- fills, and nothing more.
--
-- Three decisions are worth stating, because everything else follows from
-- them.
--
-- 1 · An event is an instant, plus the zone it was meant in.
--    `starts_at` and `ends_at` are timestamptz, so the moment is unambiguous
--    whoever is reading. But an instant alone loses what somebody meant: a
--    scrim at 20:00 Jakarta is not "13:00 UTC" to the person who scheduled it,
--    and re-saving it from a laptop in Berlin must not quietly move it. So the
--    zone it was written in is stored beside it, and editing keeps the wall
--    clock the author intended.
--
-- 2 · An all-day event is a half-open range of days in that zone.
--    Midnight local to midnight local, end exclusive — so a one-day event is
--    exactly 24 hours in its own zone, `ends_at > starts_at` holds for every
--    row, and a range query needs no special case. The routines normalise it;
--    a CHECK cannot, because converting between zones is STABLE rather than
--    IMMUTABLE.
--
-- 3 · No new permission.
--    `calendar.view`, `calendar.create` and `calendar.manage` have been in the
--    permission catalogue since 20250901000200, with role grants already
--    written. This uses them. Creating a fourth would have been inventing an
--    authorization concept the product already has.
--
-- Writes go through SECURITY DEFINER routines, as every protected write in
-- this schema does. There is no client write policy on the table.
--
-- Additive only.
-- ===========================================================================

-- --- The table -------------------------------------------------------------

create table public.calendar_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,

  title            text not null,
  description      text,
  location         text,

  -- The instant, and only the instant. Every read, every range query and every
  -- index works in UTC; the zone below is for meaning, never for filtering.
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,

  -- All-day events store midnight-to-midnight in `timezone`, end exclusive.
  all_day          boolean not null default false,

  -- An IANA zone name, validated against pg_timezone_names by the routines.
  -- Defaults to the organization's own zone when the caller does not say.
  timezone         text not null,

  -- A category and nothing else. No policy, no routine and no client code
  -- reads this to decide what anybody may do — exactly as with roles.key and
  -- channels.type.
  event_type       text not null default 'other',

  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint calendar_events_title_length
    check (char_length(btrim(title)) between 1 and 120),
  constraint calendar_events_description_length
    check (description is null or char_length(description) <= 2000),
  constraint calendar_events_location_length
    check (location is null or char_length(location) <= 200),
  constraint calendar_events_timezone_length
    check (char_length(timezone) between 1 and 64),
  constraint calendar_events_type_check
    check (event_type in ('match', 'scrim', 'practice', 'meeting', 'content', 'event', 'other')),
  -- The whole of the ordering rule, for timed and all-day alike.
  constraint calendar_events_order check (ends_at > starts_at)
);

comment on table public.calendar_events is
  'Organization calendar events. starts_at/ends_at are instants; timezone preserves the wall clock the author meant. All-day rows are midnight to midnight in that zone, end exclusive.';

comment on column public.calendar_events.event_type is
  'A category only: match, scrim, practice, meeting, content, event, other. Carries no authorization meaning of any kind.';

comment on column public.calendar_events.timezone is
  'IANA zone the event was written in. Kept so an edit from another zone does not silently move the event, and so all-day boundaries stay meaningful.';

comment on column public.calendar_events.ends_at is
  'Exclusive for all-day events: a single all-day event ends at the following midnight in its own zone.';

-- --- Indexes ---------------------------------------------------------------
-- The calendar asks one question: what is in this organization between two
-- instants. An overlap is `starts_at < range_end and ends_at > range_start`,
-- so both halves get an index and nothing else does.

create index calendar_events_org_starts_idx on public.calendar_events (organization_id, starts_at);
create index calendar_events_org_ends_idx   on public.calendar_events (organization_id, ends_at);

create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.tg_set_updated_at();

-- --- The organization is not editable --------------------------------------
-- The routines never write it, but a row must not be able to change hands
-- however it is reached.

create or replace function public.tg_calendar_event_org_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'An event cannot be moved to another organization'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

create trigger calendar_events_org_immutable
  before update on public.calendar_events
  for each row execute function public.tg_calendar_event_org_immutable();

-- --- RLS -------------------------------------------------------------------
-- Read only, and only for members holding calendar.view in that organization.
-- has_org_permission already resolves ownership, effective membership status
-- and every role the member holds; nothing is re-decided here.

alter table public.calendar_events enable row level security;

create policy "Members can read calendar events they may view"
  on public.calendar_events for select to authenticated
  using (public.has_org_permission(organization_id, 'calendar.view'));

revoke all on public.calendar_events from anon;
grant select on public.calendar_events to authenticated;

-- --- Shared checks ---------------------------------------------------------

create or replace function public.assert_valid_timezone(p_timezone text)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown timezone: %', coalesce(p_timezone, '(null)')
      using errcode = 'invalid_parameter_value';
  end if;
end;
$fn$;

comment on function public.assert_valid_timezone is
  'Rejects anything Postgres does not recognise as an IANA zone, so a stored zone can always be converted back.';

-- Midnight to midnight in the event's own zone, end exclusive. A caller who
-- passes the same day twice gets one day rather than a zero-length event.
create or replace function public.calendar_day_bounds(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  out o_starts_at timestamptz,
  out o_ends_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $fn$
begin
  o_starts_at := date_trunc('day', p_starts_at at time zone p_timezone) at time zone p_timezone;
  o_ends_at   := date_trunc('day', p_ends_at   at time zone p_timezone) at time zone p_timezone;
  if o_ends_at <= o_starts_at then
    o_ends_at := o_starts_at + interval '1 day';
  end if;
end;
$fn$;

comment on function public.calendar_day_bounds is
  'Normalises an all-day range to local midnight boundaries, end exclusive. A day is a day in the event''s own zone, not in UTC.';

-- --- Create ----------------------------------------------------------------

create or replace function public.create_calendar_event(
  p_organization_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean default false,
  p_timezone text default null,
  p_description text default null,
  p_location text default null,
  p_event_type text default 'other'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_title    text := btrim(coalesce(p_title, ''));
  v_type     text := lower(coalesce(nullif(btrim(p_event_type), ''), 'other'));
  v_all_day  boolean := coalesce(p_all_day, false);
  v_timezone text;
  v_starts   timestamptz := p_starts_at;
  v_ends     timestamptz := p_ends_at;
  v_id       uuid;
begin
  if not public.has_org_permission(p_organization_id, 'calendar.create') then
    raise exception 'You do not have permission to create calendar events'
      using errcode = 'insufficient_privilege';
  end if;

  if v_title = '' then
    raise exception 'An event needs a title' using errcode = 'check_violation';
  end if;

  if v_starts is null or v_ends is null then
    raise exception 'An event needs a start and an end' using errcode = 'check_violation';
  end if;

  -- Checked here as well as by the constraint, so the refusal reads as a
  -- sentence rather than as a constraint violation.
  if v_type not in ('match', 'scrim', 'practice', 'meeting', 'content', 'event', 'other') then
    raise exception 'Unknown event type: %', v_type using errcode = 'check_violation';
  end if;

  -- The organization's own zone is the sensible default: it is what the
  -- schedule is planned in.
  v_timezone := coalesce(
    nullif(btrim(coalesce(p_timezone, '')), ''),
    (select o.timezone from public.organizations o where o.id = p_organization_id)
  );
  perform public.assert_valid_timezone(v_timezone);

  if v_all_day then
    select o_starts_at, o_ends_at into v_starts, v_ends
    from public.calendar_day_bounds(v_starts, v_ends, v_timezone);
  elsif v_ends <= v_starts then
    raise exception 'An event has to end after it starts' using errcode = 'check_violation';
  end if;

  insert into public.calendar_events
    (organization_id, title, description, location,
     starts_at, ends_at, all_day, timezone, event_type, created_by)
  values
    (p_organization_id, v_title,
     nullif(btrim(coalesce(p_description, '')), ''),
     nullif(btrim(coalesce(p_location, '')), ''),
     v_starts, v_ends, v_all_day, v_timezone, v_type,
     (select auth.uid()))
  returning id into v_id;

  perform public.log_audit_event(
    p_organization_id, 'calendar_event.created', 'calendar_event', v_id::text,
    format('Event %s scheduled', v_title),
    jsonb_build_object('title', v_title, 'type', v_type, 'all_day', v_all_day,
                       'starts_at', v_starts, 'ends_at', v_ends, 'timezone', v_timezone)
  );
  return v_id;
end;
$fn$;

comment on function public.create_calendar_event is
  'Creates an organization calendar event. Requires calendar.create. Normalises all-day ranges and validates the zone; the organization is the caller''s argument but the permission check is what decides it.';

-- --- Update ----------------------------------------------------------------
--
-- Who may edit: anybody with calendar.manage, and the person who created the
-- event if they still hold calendar.create. That is the same shape messages
-- use — an author may edit their own words, moderation may edit anybody's —
-- and it is what the catalogue already describes calendar.manage as ("edit or
-- cancel ANY event").

create or replace function public.can_edit_calendar_event(p_event public.calendar_events)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_org_permission(p_event.organization_id, 'calendar.manage')
      or (
        p_event.created_by = (select auth.uid())
        and public.has_org_permission(p_event.organization_id, 'calendar.create')
      );
$fn$;

comment on function public.can_edit_calendar_event is
  'calendar.manage edits anything; a creator who still holds calendar.create edits their own. Never reads a role name.';

create or replace function public.update_calendar_event(
  p_event_id uuid,
  p_title text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_all_day boolean default null,
  p_timezone text default null,
  p_description text default null,
  p_location text default null,
  p_event_type text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_event    public.calendar_events;
  v_title    text;
  v_type     text;
  v_all_day  boolean;
  v_timezone text;
  v_starts   timestamptz;
  v_ends     timestamptz;
begin
  select * into v_event from public.calendar_events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = 'no_data_found';
  end if;

  -- Absent and forbidden look the same to somebody in another organization:
  -- has_org_permission is false for both.
  if not public.can_edit_calendar_event(v_event) then
    raise exception 'You do not have permission to edit this event'
      using errcode = 'insufficient_privilege';
  end if;

  v_title    := coalesce(nullif(btrim(coalesce(p_title, '')), ''), v_event.title);
  v_type     := lower(coalesce(nullif(btrim(coalesce(p_event_type, '')), ''), v_event.event_type));
  v_all_day  := coalesce(p_all_day, v_event.all_day);
  v_timezone := coalesce(nullif(btrim(coalesce(p_timezone, '')), ''), v_event.timezone);
  v_starts   := coalesce(p_starts_at, v_event.starts_at);
  v_ends     := coalesce(p_ends_at, v_event.ends_at);

  if v_type not in ('match', 'scrim', 'practice', 'meeting', 'content', 'event', 'other') then
    raise exception 'Unknown event type: %', v_type using errcode = 'check_violation';
  end if;

  perform public.assert_valid_timezone(v_timezone);

  if v_all_day then
    select o_starts_at, o_ends_at into v_starts, v_ends
    from public.calendar_day_bounds(v_starts, v_ends, v_timezone);
  elsif v_ends <= v_starts then
    raise exception 'An event has to end after it starts' using errcode = 'check_violation';
  end if;

  update public.calendar_events
  set title       = v_title,
      description = case when p_description is null then description
                         else nullif(btrim(p_description), '') end,
      location    = case when p_location is null then location
                         else nullif(btrim(p_location), '') end,
      starts_at   = v_starts,
      ends_at     = v_ends,
      all_day     = v_all_day,
      timezone    = v_timezone,
      event_type  = v_type
  where id = p_event_id;

  perform public.log_audit_event(
    v_event.organization_id, 'calendar_event.updated', 'calendar_event', p_event_id::text,
    format('Event %s updated', v_title),
    jsonb_build_object('title', v_title, 'type', v_type, 'all_day', v_all_day,
                       'starts_at', v_starts, 'ends_at', v_ends, 'timezone', v_timezone)
  );
end;
$fn$;

comment on function public.update_calendar_event is
  'Partial update: a null argument leaves the column alone. The organization is never one of them.';

-- --- Delete ----------------------------------------------------------------

create or replace function public.delete_calendar_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_event public.calendar_events;
begin
  select * into v_event from public.calendar_events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = 'no_data_found';
  end if;

  if not public.can_edit_calendar_event(v_event) then
    raise exception 'You do not have permission to delete this event'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.calendar_events where id = p_event_id;

  perform public.log_audit_event(
    v_event.organization_id, 'calendar_event.deleted', 'calendar_event', p_event_id::text,
    format('Event %s deleted', v_event.title),
    jsonb_build_object('title', v_event.title, 'type', v_event.event_type)
  );
end;
$fn$;

comment on function public.delete_calendar_event is
  'Removes an event. Same authorization as editing one: an author may take back their own, calendar.manage may take back anybody''s.';

-- --- Execution grants ------------------------------------------------------
-- Anonymous callers hold nothing here, exactly as with every other routine.

revoke execute on function public.assert_valid_timezone(text) from public, anon;
revoke execute on function public.calendar_day_bounds(timestamptz, timestamptz, text)
  from public, anon;
revoke execute on function public.can_edit_calendar_event(public.calendar_events)
  from public, anon;
revoke execute on function public.create_calendar_event(
  uuid, text, timestamptz, timestamptz, boolean, text, text, text, text) from public, anon;
revoke execute on function public.update_calendar_event(
  uuid, text, timestamptz, timestamptz, boolean, text, text, text, text) from public, anon;
revoke execute on function public.delete_calendar_event(uuid) from public, anon;

grant execute on function public.assert_valid_timezone(text) to authenticated;
grant execute on function public.calendar_day_bounds(timestamptz, timestamptz, text)
  to authenticated;
grant execute on function public.can_edit_calendar_event(public.calendar_events) to authenticated;
grant execute on function public.create_calendar_event(
  uuid, text, timestamptz, timestamptz, boolean, text, text, text, text) to authenticated;
grant execute on function public.update_calendar_event(
  uuid, text, timestamptz, timestamptz, boolean, text, text, text, text) to authenticated;
grant execute on function public.delete_calendar_event(uuid) to authenticated;

-- --- Realtime --------------------------------------------------------------
-- Postgres Changes evaluates RLS per subscriber, so a client only receives
-- events for rows it could have read anyway. `replica identity full` is what
-- makes a DELETE payload carry the organization_id the policy needs — with the
-- default identity a deletion arrives as a bare id and is dropped.

alter table public.calendar_events replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.calendar_events;
  end if;
end $$;
