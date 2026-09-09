/**
 * Phase 5.1 — the calendar foundation, verified against the live project.
 *
 * Everything the calendar claims is checked here rather than assumed: that an
 * anonymous caller holds nothing, that the write path is the routines and only
 * the routines, that a foreign organization id in a client's own argument
 * grants nothing, that an all-day event means whole days in its own zone, and
 * that an instant survives a round trip through a zone on the other side of
 * the world.
 *
 * Credentials come from the same git-ignored `.env.e2e` the other live scripts
 * read, so nothing is typed into a command line:
 *
 *   E2E_EMAIL=you@example.com
 *   E2E_PASSWORD=...
 *
 *   node scripts/verify-calendar.mjs
 *
 * Every event it creates is recorded and deleted at the end, and the last
 * check is that none of them is left behind. Exits non-zero on any failure.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function readEnvFile(path) {
  const out = {}
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...readEnvFile('.env'), ...readEnvFile('.env.e2e'), ...process.env }
const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key, E2E_EMAIL, E2E_PASSWORD } = env

if (!url || !key) {
  console.error('verify-calendar: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set.')
  process.exit(1)
}
if (!E2E_EMAIL || !E2E_PASSWORD) {
  console.error(
    'verify-calendar: no credentials.\n\n' +
      'Create a git-ignored .env.e2e in the project root:\n\n' +
      '  E2E_EMAIL=your.account@example.com\n' +
      '  E2E_PASSWORD=the-password-you-set\n',
  )
  process.exit(1)
}

let failures = 0
function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${detail}`)
  if (!passed) failures += 1
}

/** Wall clock in a zone, so a round trip can be compared as a person would. */
function wallClock(instant, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(instant))
}

console.log(`\nverifying the calendar on ${url}\n`)

// --- 1 · anonymous ---------------------------------------------------------
console.log('anonymous')
{
  const anon = createClient(url, key, { auth: { persistSession: false } })

  const { data, error } = await anon.from('calendar_events').select('id').limit(1)
  check(
    'anonymous read returns nothing',
    (data ?? []).length === 0,
    error ? `${error.code ?? ''} ${error.message}` : 'empty',
  )

  const { error: insertError } = await anon
    .from('calendar_events')
    .insert({ organization_id: '00000000-0000-4000-8000-000000000000', title: 'x' })
  check('anonymous insert refused', Boolean(insertError), insertError?.code ?? '')

  for (const [name, args] of [
    ['create_calendar_event', { p_organization_id: '00000000-0000-4000-8000-000000000000' }],
    ['update_calendar_event', { p_event_id: '00000000-0000-4000-8000-000000000000' }],
    ['delete_calendar_event', { p_event_id: '00000000-0000-4000-8000-000000000000' }],
  ]) {
    const { error: rpcError } = await anon.rpc(name, args)
    check(`anonymous ${name} refused`, Boolean(rpcError), rpcError?.code ?? '')
  }
}

// --- 2 · signed in ---------------------------------------------------------
const supabase = createClient(url, key, { auth: { persistSession: false } })
const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
  email: E2E_EMAIL,
  password: E2E_PASSWORD,
})
if (authError || !auth.user) {
  console.error(`\nverify-calendar: could not sign in — ${authError?.message ?? 'no user'}\n`)
  process.exit(1)
}
console.log(`\nsession\n  signed in as ${auth.user.email}`)

const { data: orgs } = await supabase.from('organizations').select('id, slug, timezone')
const org = (orgs ?? [])[0]
if (!org) {
  console.error('\nverify-calendar: the account is in no organization.\n')
  process.exit(1)
}

/** Everything this run creates, so nothing is left behind. */
const created = []
async function createEvent(args) {
  const { data, error } = await supabase.rpc('create_calendar_event', args)
  if (!error && data) created.push(data)
  return { id: data, error }
}

// --- 3 · create ------------------------------------------------------------
console.log('\ncreate')
const ZONE = 'Asia/Jakarta'
// A deliberately awkward instant: 20:00 in Jakarta is 13:00 UTC, and 22:00 in
// Jakarta the next day is a different calendar day in UTC.
const TIMED_START = '2026-03-01T13:00:00.000Z'
const TIMED_END = '2026-03-01T15:00:00.000Z'

const timed = await createEvent({
  p_organization_id: org.id,
  p_title: 'Calendar probe · scrim',
  p_starts_at: TIMED_START,
  p_ends_at: TIMED_END,
  p_all_day: false,
  p_timezone: ZONE,
  p_event_type: 'scrim',
})
check('authorized member can create', Boolean(timed.id), timed.error?.message ?? '')

{
  const { error } = await createEvent({
    p_organization_id: org.id,
    p_title: 'Calendar probe · backwards',
    p_starts_at: TIMED_END,
    p_ends_at: TIMED_START,
  })
  check('end before start rejected', Boolean(error), error?.code ?? '')
}
{
  const { error } = await createEvent({
    p_organization_id: org.id,
    p_title: 'Calendar probe · zero length',
    p_starts_at: TIMED_START,
    p_ends_at: TIMED_START,
  })
  check('zero-length event rejected', Boolean(error), error?.code ?? '')
}
{
  const { error } = await createEvent({
    p_organization_id: org.id,
    p_title: 'Calendar probe · nowhere',
    p_starts_at: TIMED_START,
    p_ends_at: TIMED_END,
    p_timezone: 'Mars/Olympus_Mons',
  })
  check('unknown timezone rejected', Boolean(error), error?.code ?? '')
}
{
  const { error } = await createEvent({
    p_organization_id: org.id,
    p_title: 'Calendar probe · nonsense type',
    p_starts_at: TIMED_START,
    p_ends_at: TIMED_END,
    p_event_type: 'admin',
  })
  check('unknown event type rejected', Boolean(error), error?.code ?? '')
}
{
  // A client's own argument, pointing at an organization it is not in. The
  // permission check is what decides, not the argument.
  const { error } = await createEvent({
    p_organization_id: '00000000-0000-4000-8000-000000000000',
    p_title: 'Calendar probe · cross-org',
    p_starts_at: TIMED_START,
    p_ends_at: TIMED_END,
  })
  check('cross-organization create refused', Boolean(error), error?.code ?? '')
}

// --- 4 · read --------------------------------------------------------------
console.log('\nread')
{
  const { data } = await supabase
    .from('calendar_events')
    .select('id, starts_at, ends_at, timezone, all_day, event_type, organization_id')
    .eq('id', timed.id)
  const row = (data ?? [])[0]
  check('the event reads back', Boolean(row))
  check('it belongs to this organization', row?.organization_id === org.id)
  check(
    'the instant survived the round trip',
    row && new Date(row.starts_at).toISOString() === TIMED_START,
    row ? new Date(row.starts_at).toISOString() : '',
  )
  check(
    'the zone it was written in survived',
    row?.timezone === ZONE,
    row?.timezone ?? '',
  )
  check(
    'the wall clock it meant survived',
    row && wallClock(row.starts_at, ZONE) === wallClock(TIMED_START, ZONE),
    row ? wallClock(row.starts_at, ZONE) : '',
  )
}
{
  // Overlap, not containment: a window that begins after the event started and
  // ends before it finished still contains it.
  const { data } = await supabase
    .from('calendar_events')
    .select('id')
    .eq('organization_id', org.id)
    .lt('starts_at', '2026-03-01T14:00:00.000Z')
    .gt('ends_at', '2026-03-01T13:30:00.000Z')
  check('a window overlapping the event finds it', (data ?? []).some((r) => r.id === timed.id))
}
{
  const { data } = await supabase
    .from('calendar_events')
    .select('id')
    .eq('organization_id', org.id)
    .lt('starts_at', '2026-04-01T00:00:00.000Z')
    .gt('ends_at', '2026-03-15T00:00:00.000Z')
  check('a window past the event does not', !(data ?? []).some((r) => r.id === timed.id))
}
{
  const { data } = await supabase
    .from('calendar_events')
    .select('id')
    .eq('organization_id', '00000000-0000-4000-8000-000000000000')
  check('a foreign organization id reads nothing', (data ?? []).length === 0)
}

// --- 5 · all-day -----------------------------------------------------------
console.log('\nall day')
const allDay = await createEvent({
  p_organization_id: org.id,
  // Deliberately mid-afternoon: the routine is what makes it a day.
  p_title: 'Calendar probe · all day',
  p_starts_at: '2026-03-05T09:30:00.000Z',
  p_ends_at: '2026-03-05T09:30:00.000Z',
  p_all_day: true,
  p_timezone: ZONE,
  p_event_type: 'event',
})
check('an all-day event is created', Boolean(allDay.id), allDay.error?.message ?? '')
{
  const { data } = await supabase
    .from('calendar_events')
    .select('starts_at, ends_at, all_day, timezone')
    .eq('id', allDay.id)
  const row = (data ?? [])[0]
  const startLocal = row ? wallClock(row.starts_at, ZONE) : ''
  const endLocal = row ? wallClock(row.ends_at, ZONE) : ''
  check('it starts at local midnight', startLocal.endsWith('00:00'), startLocal)
  check('it ends at the next local midnight', endLocal.endsWith('00:00'), endLocal)
  check(
    'it is exactly one day long in its own zone',
    row && new Date(row.ends_at) - new Date(row.starts_at) === 24 * 60 * 60 * 1000,
    row ? String((new Date(row.ends_at) - new Date(row.starts_at)) / 3_600_000) + 'h' : '',
  )
  check('it is marked all day', row?.all_day === true)
}

// --- 6 · the table takes no client writes ---------------------------------
console.log('\nwrite path')
{
  const { error } = await supabase
    .from('calendar_events')
    .insert({ organization_id: org.id, title: 'direct', starts_at: TIMED_START, ends_at: TIMED_END })
  check('direct insert refused', Boolean(error), error?.code ?? '')
}
{
  const { error } = await supabase
    .from('calendar_events')
    .update({ title: 'direct' })
    .eq('id', timed.id)
  const { data } = await supabase.from('calendar_events').select('title').eq('id', timed.id)
  const unchanged = (data ?? [])[0]?.title === 'Calendar probe · scrim'
  check('direct update changes nothing', Boolean(error) || unchanged, error?.code ?? 'no rows')
}
{
  const { error } = await supabase.from('calendar_events').delete().eq('id', timed.id)
  const { data } = await supabase.from('calendar_events').select('id').eq('id', timed.id)
  check(
    'direct delete removes nothing',
    Boolean(error) || (data ?? []).length === 1,
    error?.code ?? 'still there',
  )
}

// --- 7 · update ------------------------------------------------------------
console.log('\nupdate')
{
  const { error } = await supabase.rpc('update_calendar_event', {
    p_event_id: timed.id,
    p_title: 'Calendar probe · scrim moved',
    p_starts_at: '2026-03-02T13:00:00.000Z',
    p_ends_at: '2026-03-02T15:00:00.000Z',
  })
  check('authorized update works', !error, error?.message ?? '')

  const { data } = await supabase
    .from('calendar_events')
    .select('title, starts_at, timezone, event_type')
    .eq('id', timed.id)
  const row = (data ?? [])[0]
  check('the title changed', row?.title === 'Calendar probe · scrim moved')
  check('the zone was left alone', row?.timezone === ZONE, row?.timezone ?? '')
  check('the type was left alone', row?.event_type === 'scrim', row?.event_type ?? '')
}
{
  const { error } = await supabase.rpc('update_calendar_event', {
    p_event_id: timed.id,
    p_starts_at: '2026-03-02T15:00:00.000Z',
    p_ends_at: '2026-03-02T13:00:00.000Z',
  })
  check('an update that reverses the range is rejected', Boolean(error), error?.code ?? '')
}
{
  const { error } = await supabase.rpc('update_calendar_event', {
    p_event_id: '00000000-0000-4000-8000-000000000000',
    p_title: 'nowhere',
  })
  check('updating an event that is not there is refused', Boolean(error), error?.code ?? '')
}
{
  const { error } = await supabase.rpc('delete_calendar_event', {
    p_event_id: '00000000-0000-4000-8000-000000000000',
  })
  check('deleting an event that is not there is refused', Boolean(error), error?.code ?? '')
}

// --- 7b · an event cannot change hands -------------------------------------
{
  // There is no organization parameter on the update routine at all, so there
  // is nothing to send: PostgREST refuses a call carrying one. The trigger on
  // the table refuses the same thing from any other direction.
  const { error } = await supabase.rpc('update_calendar_event', {
    p_event_id: timed.id,
    p_organization_id: '00000000-0000-4000-8000-000000000000',
  })
  check('an update cannot carry an organization', Boolean(error), error?.code ?? '')

  const { data } = await supabase
    .from('calendar_events')
    .select('organization_id')
    .eq('id', timed.id)
  check('the event still belongs where it did', (data ?? [])[0]?.organization_id === org.id)
}

// --- 7c · deleting ----------------------------------------------------------
{
  const doomed = await createEvent({
    p_organization_id: org.id,
    p_title: 'Calendar probe · deletable',
    p_starts_at: '2026-03-11T10:00:00.000Z',
    p_ends_at: '2026-03-11T11:00:00.000Z',
  })
  check('an event to delete was created', Boolean(doomed.id), doomed.error?.message ?? '')

  const { error } = await supabase.rpc('delete_calendar_event', { p_event_id: doomed.id })
  check('authorized delete works', !error, error?.message ?? '')
  if (!error && doomed.id) created.splice(created.indexOf(doomed.id), 1)

  const { data } = await supabase.from('calendar_events').select('id').eq('id', doomed.id)
  check('the row is gone', (data ?? []).length === 0)

  // Deleting is permanent, so the second attempt finds nothing — which is also
  // what a stale client sees after somebody else has removed an event.
  const { error: again } = await supabase.rpc('delete_calendar_event', { p_event_id: doomed.id })
  check('deleting it twice is refused', Boolean(again), again?.code ?? '')

  const { error: editGone } = await supabase.rpc('update_calendar_event', {
    p_event_id: doomed.id,
    p_title: 'ghost',
  })
  check('editing a deleted event is refused', Boolean(editGone), editGone?.code ?? '')
}

// --- 8 · audit -------------------------------------------------------------
console.log('\naudit')
{
  const { data } = await supabase
    .from('audit_logs')
    .select('action, entity_type, entity_id')
    .eq('organization_id', org.id)
    .eq('entity_id', String(timed.id))
    .order('created_at', { ascending: false })
  const actions = (data ?? []).map((r) => r.action)
  check('creating was logged', actions.includes('calendar_event.created'), actions.join(', '))
  check('updating was logged', actions.includes('calendar_event.updated'))
}
{
  // A deletion's audit entry has to outlive the row it describes.
  const { data } = await supabase
    .from('audit_logs')
    .select('action, entity_type, entity_id')
    .eq('organization_id', org.id)
    .eq('action', 'calendar_event.deleted')
    .order('created_at', { ascending: false })
    .limit(1)
  check('deleting was logged, and survives the row', (data ?? []).length === 1)
  const { data: rows } = await supabase
    .from('calendar_events')
    .select('id')
    .eq('id', (data ?? [])[0]?.entity_id ?? '00000000-0000-4000-8000-000000000000')
  check('and the row it names is really gone', (rows ?? []).length === 0)
}
{
  const { data } = await supabase
    .from('audit_logs')
    .select('entity_type')
    .eq('organization_id', org.id)
    .eq('entity_id', String(timed.id))
  check(
    'the entity type is the calendar event',
    (data ?? []).every((r) => r.entity_type === 'calendar_event'),
  )
}

// --- 9 · realtime ----------------------------------------------------------
console.log('\nrealtime')
{
  const seen = []
  const channel = supabase
    .channel('calendar-probe')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'calendar_events' },
      (payload) => seen.push(payload.eventType),
    )

  const subscribed = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false)
    }, 15_000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        resolve(true)
      }
    })
  })
  check('a client can subscribe to the table', subscribed)

  if (subscribed) {
    const probe = await createEvent({
      p_organization_id: org.id,
      p_title: 'Calendar probe · realtime',
      p_starts_at: '2026-03-09T10:00:00.000Z',
      p_ends_at: '2026-03-09T11:00:00.000Z',
    })
    await new Promise((resolve) => setTimeout(resolve, 4_000))
    check('an INSERT arrives', seen.includes('INSERT'), seen.join(', ') || 'nothing')

    if (probe.id) {
      await supabase.rpc('delete_calendar_event', { p_event_id: probe.id })
      created.splice(created.indexOf(probe.id), 1)
      await new Promise((resolve) => setTimeout(resolve, 4_000))
      // Which is what `replica identity full` is for: without it a DELETE
      // arrives as a bare id and RLS drops it.
      check('a DELETE arrives', seen.includes('DELETE'), seen.join(', ') || 'nothing')
    }
  }

  await supabase.removeChannel(channel)
}

// --- 10 · cleanup ----------------------------------------------------------
console.log('\ncleanup')
for (const id of [...created]) {
  const { error } = await supabase.rpc('delete_calendar_event', { p_event_id: id })
  if (!error) created.splice(created.indexOf(id), 1)
}
check('the probe takes back everything it made', created.length === 0, `${created.length} left`)
{
  const { data } = await supabase
    .from('calendar_events')
    .select('id, title')
    .eq('organization_id', org.id)
    .like('title', 'Calendar probe%')
  check('no probe events remain', (data ?? []).length === 0, `${(data ?? []).length} found`)
}

// Local scope: the default revokes every refresh token this account holds,
// which would sign the operator out of their own browser for running a check.
await supabase.auth.signOut({ scope: 'local' })

console.log(
  failures === 0
    ? '\nAll calendar checks passed.\n\nEvery event this run created was deleted again; the audit entries stay,\nby design. Refusals for a member who lacks the permission cannot be\nchecked from here — the account is the owner, who implicitly holds\neverything — and are enforced by has_org_permission in each routine.\n'
    : `\n${String(failures)} check(s) FAILED.\n`,
)
process.exit(failures === 0 ? 0 : 1)
