-- ===========================================================================
-- LFG HQ · Phase 5.3D · Calendar reminders and calendar notifications
--
-- Two small things, both built on what already exists.
--
-- 1. A reminder is one nullable integer on the event: how many minutes before
--    it starts somebody should be told. NULL is no reminder. There is no
--    reminder table because there is no product question a second row would
--    answer yet — one event, one reminder, one recipient. When attendees
--    arrive they will need per-person reminders, and that is the phase that
--    should introduce the table, with the recipients it exists to serve.
--
-- 2. Notifications go in `public.notifications`, whose own comment already
--    anticipated this: "Thread replies, direct messages and calendar reminders
--    will each need code, but none of them will need this file." None of it
--    needed changing.
--
-- Who is told, and why only them:
--
--   There is no attendee model, so there is no set of people a calendar event
--   implicates. Inventing one — everybody with `calendar.view`, say — would be
--   a new recipient concept, and this application has never had one: every
--   notification it has ever written was addressed to somebody a specific
--   action named. So the only recipient this phase can justify is the person
--   who created the event, and only for things done to it by somebody else.
--   Creating an event notifies nobody, because the only person it implicates
--   is the one who did it.
--
-- Additive only. No permission is added: editing a reminder is editing the
-- event, and `can_edit_calendar_event` already decides that.
-- ===========================================================================

-- --- The reminder itself ---------------------------------------------------

alter table public.calendar_events
  add column if not exists reminder_minutes integer;

comment on column public.calendar_events.reminder_minutes is
  'Minutes before starts_at to remind the event''s creator. NULL is no reminder; 0 is at the time it starts.';

-- The allowed set, in the database, because a client is not what decides it.
alter table public.calendar_events
  drop constraint if exists calendar_events_reminder_minutes_valid;

alter table public.calendar_events
  add constraint calendar_events_reminder_minutes_valid
  check (reminder_minutes is null or reminder_minutes in (0, 5, 15, 30, 60, 1440));

-- Only events that want one are ever scanned for a due reminder.
create index if not exists calendar_events_reminder_idx
  on public.calendar_events (starts_at)
  where reminder_minutes is not null;

-- --- When it is due --------------------------------------------------------
--
-- Derived, never stored. `starts_at` is already an instant, so this is instant
-- arithmetic and nothing about a browser, a viewer's zone or a local midnight
-- enters into it. An all-day event stored as midnight in Asia/Jakarta reminds
-- relative to that midnight, because that is the instant it begins.
--
-- Deriving it rather than storing it is also what makes moving an event safe:
-- there is no second copy of the schedule to forget to update.

create or replace function public.calendar_reminder_at(
  p_starts_at timestamptz,
  p_reminder_minutes integer
)
returns timestamptz
language sql
stable
set search_path = ''
as $fn$
  select case
    when p_reminder_minutes is null then null
    else p_starts_at - make_interval(mins => p_reminder_minutes)
  end;
$fn$;

comment on function public.calendar_reminder_at is
  'The instant a reminder is due: the event''s own start, less the configured minutes. NULL when there is no reminder.';

grant execute on function public.calendar_reminder_at(timestamptz, integer) to authenticated;

-- --- The ledger that makes delivery exactly-once ---------------------------
--
-- One row per reminder actually sent, keyed by the event and the instant it
-- was due. The primary key is the whole mechanism: a second worker, a retry,
-- an overlapping run and a scheduler that fires twice all try to insert the
-- same key, and all but one lose.
--
-- Keying on the *computed* instant is also what handles an event being moved.
-- 10:00 with a fifteen-minute reminder is due at 09:45; move the event to
-- 11:00 and it is due at 10:45, which is a different key, so the new time is
-- eligible and the old delivery cannot suppress it. Nothing has to be reset.
--
-- No RLS policies and no grants: nothing outside SECURITY DEFINER code has any
-- business reading or writing this. The observable outcome is the
-- notification, which is already scoped to its recipient.

create table if not exists public.calendar_reminder_deliveries (
  event_id     uuid not null references public.calendar_events (id) on delete cascade,
  remind_at    timestamptz not null,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  delivered_at timestamptz not null default now(),

  primary key (event_id, remind_at, recipient_id)
);

comment on table public.calendar_reminder_deliveries is
  'One row per reminder delivered, keyed by event and due instant. Written only by SECURITY DEFINER code; the key is what makes delivery exactly-once.';

alter table public.calendar_reminder_deliveries enable row level security;

revoke all on public.calendar_reminder_deliveries from anon, authenticated;

-- --- How a reminder reads --------------------------------------------------

create or replace function public.calendar_reminder_phrase(p_minutes integer)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case p_minutes
    when 0    then 'starts now'
    when 60   then 'starts in an hour'
    when 1440 then 'starts tomorrow'
    else 'starts in ' || p_minutes::text || ' minutes'
  end;
$fn$;

comment on function public.calendar_reminder_phrase is
  'The tail of a reminder''s one line: "starts in 15 minutes", "starts now", "starts tomorrow".';

create or replace function public.assert_valid_reminder(p_minutes integer)
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_minutes is null then
    return;
  end if;
  if p_minutes not in (0, 5, 15, 30, 60, 1440) then
    raise exception 'That is not a reminder time this calendar offers'
      using errcode = 'check_violation';
  end if;
end;
$fn$;

comment on function public.assert_valid_reminder is
  'Refuses any reminder outside the offered set, as a sentence rather than as a constraint violation.';

grant execute on function public.assert_valid_reminder(integer) to authenticated;

-- --- Creating, with a reminder ---------------------------------------------
--
-- The body is 5.1's, with one parameter and two lines added. Dropped and
-- recreated rather than overloaded: two candidate signatures is how PostgREST
-- starts refusing calls as ambiguous.

drop function if exists public.create_calendar_event(
  uuid, text, timestamptz, timestamptz, boolean, text, text, text, text);

create or replace function public.create_calendar_event(
  p_organization_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean default false,
  p_timezone text default null,
  p_description text default null,
  p_location text default null,
  p_event_type text default 'other',
  p_reminder_minutes integer default null
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

  if v_type not in ('match', 'scrim', 'practice', 'meeting', 'content', 'event', 'other') then
    raise exception 'Unknown event type: %', v_type using errcode = 'check_violation';
  end if;

  -- Never the client's word for it.
  perform public.assert_valid_reminder(p_reminder_minutes);

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
     starts_at, ends_at, all_day, timezone, event_type, created_by, reminder_minutes)
  values
    (p_organization_id, v_title,
     nullif(btrim(coalesce(p_description, '')), ''),
     nullif(btrim(coalesce(p_location, '')), ''),
     v_starts, v_ends, v_all_day, v_timezone, v_type,
     (select auth.uid()), p_reminder_minutes)
  returning id into v_id;

  perform public.log_audit_event(
    p_organization_id, 'calendar_event.created', 'calendar_event', v_id::text,
    format('Event %s scheduled', v_title),
    jsonb_build_object('title', v_title, 'type', v_type, 'all_day', v_all_day,
                       'starts_at', v_starts, 'ends_at', v_ends, 'timezone', v_timezone,
                       'reminder_minutes', p_reminder_minutes)
  );

  -- Nobody is notified. The only person a new event implicates is the one who
  -- scheduled it, and telling somebody what they just did is noise.
  return v_id;
end;
$fn$;

comment on function public.create_calendar_event is
  'Creates an organization calendar event. Requires calendar.create. Normalises all-day ranges, validates the zone and the reminder; the organization is the caller''s argument but the permission check is what decides it.';

revoke execute on function public.create_calendar_event(
  uuid, text, timestamptz, timestamptz, boolean, text, text, text, text, integer)
  from public, anon;
grant execute on function public.create_calendar_event(
  uuid, text, timestamptz, timestamptz, boolean, text, text, text, text, integer)
  to authenticated;

-- --- Editing, and telling the person whose event it is ---------------------
--
-- `p_reminder_minutes` follows this file's existing convention for a partial
-- update, one step further: NULL leaves the reminder alone, exactly as NULL
-- leaves the title alone, and -1 removes it — the integer equivalent of the
-- empty string that clears a description. The client never types -1; the
-- service layer turns "no reminder" into it, in one line.

drop function if exists public.update_calendar_event(
  uuid, text, timestamptz, timestamptz, boolean, text, text, text, text);

create or replace function public.update_calendar_event(
  p_event_id uuid,
  p_title text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_all_day boolean default null,
  p_timezone text default null,
  p_description text default null,
  p_location text default null,
  p_event_type text default null,
  p_reminder_minutes integer default null
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
  v_reminder integer;
  v_actor    uuid := (select auth.uid());
  v_name     text;
begin
  select * into v_event from public.calendar_events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = 'no_data_found';
  end if;

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
  v_reminder := case
                  when p_reminder_minutes is null then v_event.reminder_minutes
                  when p_reminder_minutes = -1    then null
                  else p_reminder_minutes
                end;

  if v_type not in ('match', 'scrim', 'practice', 'meeting', 'content', 'event', 'other') then
    raise exception 'Unknown event type: %', v_type using errcode = 'check_violation';
  end if;

  perform public.assert_valid_reminder(v_reminder);
  perform public.assert_valid_timezone(v_timezone);

  if v_all_day then
    select o_starts_at, o_ends_at into v_starts, v_ends
    from public.calendar_day_bounds(v_starts, v_ends, v_timezone);
  elsif v_ends <= v_starts then
    raise exception 'An event has to end after it starts' using errcode = 'check_violation';
  end if;

  update public.calendar_events
  set title            = v_title,
      description      = case when p_description is null then description
                              else nullif(btrim(p_description), '') end,
      location         = case when p_location is null then location
                              else nullif(btrim(p_location), '') end,
      starts_at        = v_starts,
      ends_at          = v_ends,
      all_day          = v_all_day,
      timezone         = v_timezone,
      event_type       = v_type,
      reminder_minutes = v_reminder
  where id = p_event_id;

  perform public.log_audit_event(
    v_event.organization_id, 'calendar_event.updated', 'calendar_event', p_event_id::text,
    format('Event %s updated', v_title),
    jsonb_build_object('title', v_title, 'type', v_type, 'all_day', v_all_day,
                       'starts_at', v_starts, 'ends_at', v_ends, 'timezone', v_timezone,
                       'reminder_minutes', v_reminder)
  );

  -- Somebody else's event was changed under them. Only that person, only when
  -- it was not them, and only while they can still see the calendar it is on.
  if v_event.created_by is not null
     and v_event.created_by is distinct from v_actor
     and public.has_org_permission_for(v_event.created_by, v_event.organization_id, 'calendar.view')
  then
    select coalesce(p.display_name, p.full_name, p.email) into v_name
    from public.profiles p where p.id = v_actor;

    insert into public.notifications (
      organization_id, recipient_id, type, entity_type, entity_id,
      actor_id, summary, metadata
    )
    values (
      v_event.organization_id,
      v_event.created_by,
      'calendar_event_updated',
      'calendar_event',
      p_event_id::text,
      v_actor,
      left(format('%s changed %s', coalesce(v_name, 'Somebody'), v_title), 300),
      jsonb_build_object(
        'event_id', p_event_id,
        'title', v_title,
        'event_type', v_type,
        'starts_at', v_starts,
        'all_day', v_all_day,
        -- The bell already renders `excerpt` as a notification's second line.
        'excerpt', to_char(v_starts at time zone v_timezone, 'Dy DD Mon') ||
                   case when v_all_day then ' · all day'
                        else ' · ' || to_char(v_starts at time zone v_timezone, 'HH24:MI') end
      )
    );
  end if;
end;
$fn$;

comment on function public.update_calendar_event is
  'Partial update: a null argument leaves the column alone, and -1 clears the reminder. The organization is never one of them. Notifies the event''s creator when somebody else changes it.';

revoke execute on function public.update_calendar_event(
  uuid, text, timestamptz, timestamptz, boolean, text, text, text, text, integer)
  from public, anon;
grant execute on function public.update_calendar_event(
  uuid, text, timestamptz, timestamptz, boolean, text, text, text, text, integer)
  to authenticated;

-- --- Cancelling, and telling the person whose event it was -----------------

create or replace function public.delete_calendar_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_event public.calendar_events;
  v_actor uuid := (select auth.uid());
  v_name  text;
begin
  select * into v_event from public.calendar_events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found' using errcode = 'no_data_found';
  end if;

  if not public.can_edit_calendar_event(v_event) then
    raise exception 'You do not have permission to delete this event'
      using errcode = 'insufficient_privilege';
  end if;

  -- The deliveries go with it, so a reminder cannot fire for an event that no
  -- longer exists — and the ledger does not accumulate rows for nothing.
  delete from public.calendar_events where id = p_event_id;

  perform public.log_audit_event(
    v_event.organization_id, 'calendar_event.deleted', 'calendar_event', p_event_id::text,
    format('Event %s deleted', v_event.title),
    jsonb_build_object('title', v_event.title, 'type', v_event.event_type)
  );

  if v_event.created_by is not null
     and v_event.created_by is distinct from v_actor
     and public.has_org_permission_for(v_event.created_by, v_event.organization_id, 'calendar.view')
  then
    select coalesce(p.display_name, p.full_name, p.email) into v_name
    from public.profiles p where p.id = v_actor;

    insert into public.notifications (
      organization_id, recipient_id, type, entity_type, entity_id,
      actor_id, summary, metadata
    )
    values (
      v_event.organization_id,
      v_event.created_by,
      'calendar_event_deleted',
      'calendar_event',
      p_event_id::text,
      v_actor,
      left(format('%s cancelled %s', coalesce(v_name, 'Somebody'), v_event.title), 300),
      jsonb_build_object(
        'event_id', p_event_id,
        'title', v_event.title,
        'event_type', v_event.event_type,
        'excerpt', 'Removed from the calendar'
      )
    );
  end if;
end;
$fn$;

comment on function public.delete_calendar_event is
  'Removes an event. Same authorization as editing one. Notifies the event''s creator when somebody else cancels it; the audit entry and the notification both outlive the row.';

-- --- Delivering what is due ------------------------------------------------
--
-- One pass over the events whose reminder has just come due. Everything about
-- it is deliberately dull:
--
--   · the window is bounded to a quarter of an hour however it is called, so a
--     worker three minutes late still delivers and one twenty minutes late
--     resurrects nothing
--   · the event is read live, so a cancelled event has no reminder to send
--   · the due instant is computed from the event's current start, so a moved
--     event reminds at its new time and never at its old one
--   · the recipient is checked against the calendar they would be told about
--   · the ledger insert is the claim; only the transaction that wins it writes
--     the notification, so two workers, a retry and a double schedule all
--     produce exactly one
--
-- Executable by a signed-in member, refused to anonymous. It cannot deliver
-- anything that is not already due, cannot deliver anything twice, and returns
-- a count rather than any content — so a member calling it early is a member
-- doing the scheduler's job a moment sooner, not a member learning anything.

create or replace function public.deliver_due_calendar_reminders(
  p_window interval default interval '5 minutes'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- Clamped, not trusted. A minute is the floor because a scheduler that runs
  -- every minute must not miss the reminder it woke up for; a quarter of an
  -- hour is the ceiling because a reminder nobody delivered for that long is
  -- not news any more, and no caller should be able to ask for one that is.
  v_window  interval := least(
                          greatest(coalesce(p_window, interval '5 minutes'), interval '1 minute'),
                          interval '15 minutes');
  v_now     timestamptz := now();
  v_due     record;
  v_claimed boolean;
  v_sent    integer := 0;
begin
  for v_due in
    select e.id,
           e.organization_id,
           e.created_by,
           e.title,
           e.event_type,
           e.starts_at,
           e.all_day,
           e.timezone,
           e.reminder_minutes,
           public.calendar_reminder_at(e.starts_at, e.reminder_minutes) as remind_at
    from public.calendar_events e
    where e.reminder_minutes is not null
      and e.created_by is not null
      and public.calendar_reminder_at(e.starts_at, e.reminder_minutes) <= v_now
      and public.calendar_reminder_at(e.starts_at, e.reminder_minutes) > v_now - v_window
    order by e.starts_at
  loop
    -- Somebody suspended, banned or removed since they scheduled it is not
    -- told about a calendar they can no longer see.
    if not public.has_org_permission_for(
         v_due.created_by, v_due.organization_id, 'calendar.view') then
      continue;
    end if;

    insert into public.calendar_reminder_deliveries (event_id, remind_at, recipient_id)
    values (v_due.id, v_due.remind_at, v_due.created_by)
    on conflict do nothing;

    get diagnostics v_claimed = row_count;
    if not v_claimed then
      continue;
    end if;

    insert into public.notifications (
      organization_id, recipient_id, type, entity_type, entity_id,
      actor_id, summary, metadata
    )
    values (
      v_due.organization_id,
      v_due.created_by,
      'calendar_reminder',
      'calendar_event',
      v_due.id::text,
      null,
      left(format('%s %s', v_due.title, public.calendar_reminder_phrase(v_due.reminder_minutes)), 300),
      jsonb_build_object(
        'event_id', v_due.id,
        'title', v_due.title,
        'event_type', v_due.event_type,
        'starts_at', v_due.starts_at,
        'all_day', v_due.all_day,
        'reminder_minutes', v_due.reminder_minutes,
        'excerpt', to_char(v_due.starts_at at time zone v_due.timezone, 'Dy DD Mon') ||
                   case when v_due.all_day then ' · all day'
                        else ' · ' || to_char(v_due.starts_at at time zone v_due.timezone, 'HH24:MI') end
      )
    );

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$fn$;

comment on function public.deliver_due_calendar_reminders is
  'Delivers every reminder that has just come due, exactly once each, and returns how many. Bounded window; nothing older than the window is ever resurrected.';

revoke execute on function public.deliver_due_calendar_reminders(interval) from public, anon;
grant execute on function public.deliver_due_calendar_reminders(interval) to authenticated;

-- --- A scheduler, if this project has one ----------------------------------
--
-- Deliberately conditional, and deliberately not creating anything. If pg_cron
-- is already installed the delivery routine gets a minute-by-minute job and
-- reminders are real; if it is not, this migration says so in a notice and
-- changes nothing. Installing an extension on somebody's production database
-- is not a thing a calendar feature should do on its way past, and a reminder
-- system that quietly depends on a scheduler nobody enabled is worse than one
-- that admits it has none.
--
-- On the LFG HQ project pg_cron is enabled, so the branch below is the one
-- that runs: `calendar-reminders` calls the routine every minute, and a
-- reminder due at 09:45 is delivered within the minute after it. Enabling the
-- extension is the only thing that was ever missing; nothing else changed.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'calendar-reminders',
      '* * * * *',
      $job$select public.deliver_due_calendar_reminders()$job$
    );
    raise notice 'pg_cron found: calendar reminders scheduled every minute.';
  else
    raise notice 'pg_cron is not installed. deliver_due_calendar_reminders() is ready, but nothing calls it yet.';
  end if;
end $$;

-- Nothing to do for realtime: `notifications` has been in the publication
-- since C2 and the bell already refetches on an INSERT, so a reminder lands in
-- it the moment it is written.
