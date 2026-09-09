/**
 * Calendar reminders, against the live project.
 *
 * The delivery routine is the part of this phase with no user interface to
 * watch, so it is checked here the way the anonymous surface is checked: with
 * real calls, real rows and real refusals, printed one line each.
 *
 * What it establishes:
 *
 *   · only the offered reminder times are accepted, and only server-side
 *   · a reminder is an instant derived from the event's own start
 *   · a due reminder is delivered exactly once, however many times the
 *     delivery routine is called, including concurrently
 *   · a reminder that is not due yet, one that went stale, one whose event was
 *     deleted and one whose event has moved are all left alone
 *   · anonymous callers are refused everything
 *
 *   node scripts/verify-calendar-reminders.mjs
 *
 * Every event it creates is deleted again. The notifications it delivers
 * cannot be deleted — the table has no DELETE policy, by design — so it marks
 * them read and reports how many it left.
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
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...readEnvFile('.env'), ...readEnvFile('.env.e2e'), ...process.env }
const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key, E2E_EMAIL, E2E_PASSWORD } = env

if (!url || !key || !E2E_EMAIL || !E2E_PASSWORD) {
  console.error('verify-calendar-reminders: missing configuration. See .env / .env.e2e.')
  process.exit(1)
}

let failures = 0
function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(56)} ${detail}`)
  if (!passed) failures += 1
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const anon = createClient(url, key, { auth: { persistSession: false } })

const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
  email: E2E_EMAIL,
  password: E2E_PASSWORD,
})
if (authError) {
  console.error(`verify-calendar-reminders: sign-in failed — ${authError.message}`)
  process.exit(1)
}
const me = auth.user.id

const { data: orgs } = await supabase.from('organizations').select('id')
const org = orgs?.[0]?.id
if (!org) {
  console.error('verify-calendar-reminders: no organization.')
  process.exit(1)
}

const TITLE = 'Reminder probe'
const made = []

/** An event, at an offset from now, with whatever reminder is under test. */
async function schedule(what, startsInMinutes, reminder, extra = {}) {
  const starts = new Date(Date.now() + startsInMinutes * 60_000)
  const { data, error } = await supabase.rpc('create_calendar_event', {
    p_organization_id: org,
    p_title: `${TITLE} · ${what}`,
    p_starts_at: starts.toISOString(),
    p_ends_at: new Date(starts.getTime() + 3_600_000).toISOString(),
    p_all_day: false,
    p_timezone: 'Asia/Jakarta',
    p_event_type: 'scrim',
    p_reminder_minutes: reminder,
    ...extra,
  })
  if (data) made.push(data)
  return { id: data, error }
}

/** Every reminder notification this run has caused, newest first. */
async function reminders() {
  const { data } = await supabase
    .from('notifications')
    .select('id, recipient_id, type, entity_type, entity_id, summary, metadata, read_at')
    .eq('type', 'calendar_reminder')
    .order('created_at', { ascending: false })
    .limit(100)
  return (data ?? []).filter((row) => String(row.metadata?.title ?? '').startsWith(TITLE))
}

const deliver = (window = '5 minutes') =>
  supabase.rpc('deliver_due_calendar_reminders', { p_window: window })

console.log('\n1 · only the reminders this calendar offers')
{
  for (const minutes of [null, 0, 5, 15, 30, 60, 1440]) {
    const { id, error } = await schedule(`valid ${String(minutes)}`, 600, minutes)
    check(`a reminder of ${String(minutes)} is accepted`, !error && Boolean(id), error?.message ?? '')
  }
  for (const minutes of [7, -5, 1441, 3, 100000]) {
    const { error } = await schedule(`invalid ${String(minutes)}`, 600, minutes)
    check(
      `a reminder of ${String(minutes)} is refused`,
      Boolean(error),
      error ? error.message : 'accepted',
    )
  }
  // -1 is the update routine's "remove it", not a reminder anybody may set.
  const { error: minusOne } = await schedule('invalid -1', 600, -1)
  check('and -1 is not a reminder time either', Boolean(minusOne), minusOne?.message ?? 'accepted')
}

console.log('\n2 · changing one')
{
  const { id } = await schedule('editable', 600, 15)
  const read = async () => {
    const { data } = await supabase.from('calendar_events').select('reminder_minutes').eq('id', id)
    return data?.[0]?.reminder_minutes ?? null
  }

  check('it starts at 15', (await read()) === 15)

  await supabase.rpc('update_calendar_event', { p_event_id: id, p_reminder_minutes: 30 })
  check('30 replaces it', (await read()) === 30)

  await supabase.rpc('update_calendar_event', { p_event_id: id, p_title: `${TITLE} · renamed` })
  check('an edit that says nothing about it leaves it alone', (await read()) === 30)

  await supabase.rpc('update_calendar_event', { p_event_id: id, p_reminder_minutes: -1 })
  check('-1 removes it', (await read()) === null)

  const { error } = await supabase.rpc('update_calendar_event', {
    p_event_id: id,
    p_reminder_minutes: 7,
  })
  check('an invalid one is refused on the way in', Boolean(error), error?.message ?? 'accepted')
  check('and the event still has none', (await read()) === null)
}

console.log('\n3 · when a reminder is due')
{
  const starts = '2031-04-08T13:00:00.000Z'
  const at = async (minutes) => {
    const { data } = await supabase.rpc('calendar_reminder_at', {
      p_starts_at: starts,
      p_reminder_minutes: minutes,
    })
    return data
  }
  check('no reminder is due at no time', (await at(null)) === null)
  check('0 is due when it starts', new Date(await at(0)).toISOString() === starts)
  check(
    '15 is due a quarter of an hour before',
    new Date(await at(15)).toISOString() === '2031-04-08T12:45:00.000Z',
  )
  check(
    'a day before is a day before the instant, not a local midnight',
    new Date(await at(1440)).toISOString() === '2031-04-07T13:00:00.000Z',
  )

  // An all-day event is stored as midnight in its own zone; the reminder comes
  // off that instant, so it means what its author meant wherever it is read.
  const { id } = await schedule('all day', 600, 1440, {
    p_all_day: true,
    p_starts_at: '2031-04-20T09:00:00.000Z',
    p_ends_at: '2031-04-20T10:00:00.000Z',
  })
  const { data: row } = await supabase
    .from('calendar_events')
    .select('starts_at, all_day')
    .eq('id', id)
  const stored = row?.[0]?.starts_at
  check('an all-day event begins at its own midnight', new Date(stored).toISOString() === '2031-04-19T17:00:00.000Z', String(stored))
  const { data: dueAt } = await supabase.rpc('calendar_reminder_at', {
    p_starts_at: stored,
    p_reminder_minutes: 1440,
  })
  check(
    'and its reminder is a day before that',
    new Date(dueAt).toISOString() === '2031-04-18T17:00:00.000Z',
    String(dueAt),
  )
}

console.log('\n4 · delivering one that is due')
let deliveredId = null
{
  // Starting in fifteen minutes with a fifteen-minute reminder: due now.
  const { id } = await schedule('due now', 15, 15)
  deliveredId = id

  const before = (await reminders()).length
  const { data: sent, error } = await deliver()
  check('the routine ran', !error, error?.message ?? '')
  // Not `sent >= 1`: pg_cron is calling the same routine every minute, and if
  // it got there first this call correctly delivers nothing. What has to be
  // true is about the event, and it is true whichever caller won.
  console.log(`        this call delivered ${String(sent)}`)

  const after = await reminders()
  const mine = after.filter((row) => row.entity_id === id)
  check('exactly one notification for this event', mine.length === 1, `${String(mine.length)} found`)
  check('addressed to whoever scheduled it', mine[0]?.recipient_id === me)
  check('and to nobody else', after.length === before + 1, `${String(after.length)} total`)
  check(
    'it reads as a sentence',
    /starts in 15 minutes$/.test(mine[0]?.summary ?? ''),
    mine[0]?.summary ?? '',
  )
  check(
    'and carries the event it is about',
    mine[0]?.entity_type === 'calendar_event' && Boolean(mine[0]?.metadata?.event_id),
  )
}

console.log('\n5 · and never twice')
{
  await deliver()
  const once = (await reminders()).filter((row) => row.entity_id === deliveredId)
  check('a second run adds nothing', once.length === 1, `${String(once.length)} found`)

  await Promise.all([deliver(), deliver(), deliver()])
  const mine = (await reminders()).filter((row) => row.entity_id === deliveredId)
  check('nor do three at once', mine.length === 1, `${String(mine.length)} found`)
}

console.log('\n6 · what is not due, and what is too late')
{
  // Due in an hour and a half: not now.
  const { id: future } = await schedule('not yet', 120, 30)
  // Due forty minutes ago: outside the window a scheduler is allowed to catch.
  const { id: stale } = await schedule('too late', -25, 15)

  await deliver()
  const all = await reminders()
  check('nothing for the future one', all.every((row) => row.entity_id !== future))
  check('nothing for the stale one', all.every((row) => row.entity_id !== stale))

  // A caller asking for an absurd window does not get one: it is clamped, so
  // an hours-old reminder cannot be resurrected by asking nicely.
  await deliver('10 years')
  const after = await reminders()
  check(
    'a huge window is clamped, so the stale one stays undelivered',
    after.every((row) => row.entity_id !== stale),
  )
}

console.log('\n7 · events that moved or went away')
{
  const { id: moved } = await schedule('moved', 15, 15)
  await deliver()
  const firstTime = (await reminders()).filter((row) => row.entity_id === moved)
  check('the reminder at its first time is delivered', firstTime.length === 1)

  // Pushed an hour later: due in an hour, so nothing is due now — and the
  // delivery already made cannot be mistaken for the new one.
  const later = new Date(Date.now() + 75 * 60_000)
  await supabase.rpc('update_calendar_event', {
    p_event_id: moved,
    p_starts_at: later.toISOString(),
    p_ends_at: new Date(later.getTime() + 3_600_000).toISOString(),
  })
  await deliver()
  const afterMove = (await reminders()).filter((row) => row.entity_id === moved)
  check('moving it does not deliver a second one', afterMove.length === 1, `${String(afterMove.length)} found`)

  // Brought back so its new reminder is due now: a different instant, so it is
  // a different reminder, and it is delivered.
  const soon = new Date(Date.now() + 15 * 60_000)
  await supabase.rpc('update_calendar_event', {
    p_event_id: moved,
    p_starts_at: soon.toISOString(),
    p_ends_at: new Date(soon.getTime() + 3_600_000).toISOString(),
  })
  await deliver()
  const afterReturn = (await reminders()).filter((row) => row.entity_id === moved)
  check(
    'its new time is eligible in its own right',
    afterReturn.length === 2,
    `${String(afterReturn.length)} found`,
  )

  // Deleted before its reminder comes due: nothing to deliver, ever.
  const { id: doomed } = await schedule('cancelled', 15, 15)
  await supabase.rpc('delete_calendar_event', { p_event_id: doomed })
  made.splice(made.indexOf(doomed), 1)
  await deliver()
  const all = await reminders()
  check('a cancelled event reminds nobody', all.every((row) => row.entity_id !== doomed))
}

console.log('\n8 · who may do any of this')
{
  const { id } = await schedule('guarded', 600, 15)

  // Anonymous: the anon key and no session at all.
  const { error: createError } = await anon.rpc('create_calendar_event', {
    p_organization_id: org,
    p_title: `${TITLE} · anonymous`,
    p_starts_at: '2031-05-01T10:00:00.000Z',
    p_ends_at: '2031-05-01T11:00:00.000Z',
    p_reminder_minutes: 15,
  })
  check('anonymous cannot schedule a reminder', Boolean(createError), createError?.code ?? '')

  const { error: updateError } = await anon.rpc('update_calendar_event', {
    p_event_id: id,
    p_reminder_minutes: 60,
  })
  check('anonymous cannot change one', Boolean(updateError), updateError?.code ?? '')

  const { error: deleteError } = await anon.rpc('delete_calendar_event', { p_event_id: id })
  check('anonymous cannot delete the event under it', Boolean(deleteError), deleteError?.code ?? '')

  const { error: runError } = await anon.rpc('deliver_due_calendar_reminders', {})
  check('anonymous cannot run the delivery routine', Boolean(runError), runError?.code ?? '')

  const { data: row } = await supabase
    .from('calendar_events')
    .select('reminder_minutes')
    .eq('id', id)
  check('and the reminder is exactly as it was', row?.[0]?.reminder_minutes === 15)

  // The ledger is not a table anybody reads.
  const { error: ledger } = await supabase.from('calendar_reminder_deliveries').select('event_id')
  check(
    'the delivery ledger is not readable by a signed-in client',
    Boolean(ledger),
    ledger?.code ?? 'readable',
  )
  const { error: anonLedger } = await anon.from('calendar_reminder_deliveries').select('event_id')
  check('nor by an anonymous one', Boolean(anonLedger), anonLedger?.code ?? 'readable')

  // Notifications are the recipient's own, always.
  const { data: anonNotifications } = await anon.from('notifications').select('id')
  check('anonymous reads no notifications', (anonNotifications ?? []).length === 0)
}

console.log('\n9 · editing your own event tells you nothing')
{
  const before = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .in('type', ['calendar_event_updated', 'calendar_event_deleted'])

  const { id } = await schedule('self', 600, null)
  await supabase.rpc('update_calendar_event', { p_event_id: id, p_title: `${TITLE} · self again` })
  await supabase.rpc('delete_calendar_event', { p_event_id: id })
  made.splice(made.indexOf(id), 1)

  const after = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .in('type', ['calendar_event_updated', 'calendar_event_deleted'])

  check(
    'nobody is told about their own edits',
    (after.count ?? 0) === (before.count ?? 0),
    `${String(before.count)} → ${String(after.count)}`,
  )
  console.log(
    '        the same rule is what makes the "somebody else changed your event"\n' +
      '        notification untestable here: one account cannot be somebody else.',
  )
}

console.log('\ncleanup')
{
  for (const id of made) {
    await supabase.rpc('delete_calendar_event', { p_event_id: id })
  }
  const { data: left } = await supabase
    .from('calendar_events')
    .select('id')
    .like('title', `${TITLE}%`)
  check('every probe event is gone', (left ?? []).length === 0, `${String((left ?? []).length)} left`)

  // Notifications cannot be deleted — the table has no DELETE policy, on
  // purpose — so the most this can do is leave them read.
  const delivered = await reminders()
  if (delivered.length > 0) {
    await supabase.rpc('mark_notifications_read', { p_ids: delivered.map((row) => row.id) })
  }
  const stillUnread = (await reminders()).filter((row) => row.read_at === null)
  check('and every reminder it delivered is marked read', stillUnread.length === 0)
  if (delivered.length > 0) {
    console.log(
      `        ${String(delivered.length)} reminder notification(s) remain. The table has no\n` +
        '        DELETE policy - a notification is marked read, not erased - and adding\n' +
        '        one to tidy up after a test would be weakening the product to suit the\n' +
        '        test. Clearing them is an operator job:\n\n' +
        "          delete from public.notifications where type = 'calendar_reminder'\n" +
        "            and metadata->>'title' like 'Reminder probe%';\n",
    )
  }
}

await supabase.auth.signOut({ scope: 'local' })

console.log(
  failures === 0
    ? '\nAll calendar reminder checks passed.\n'
    : `\n${String(failures)} check(s) failed.\n`,
)
process.exit(failures === 0 ? 0 : 1)
