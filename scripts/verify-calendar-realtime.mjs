/**
 * What Supabase Realtime actually delivers for `calendar_events`, and to whom.
 *
 * Phase 5.1 put the table in the publication and gave it `replica identity
 * full`, on the stated belief that Postgres Changes evaluates the SELECT
 * policy per subscriber — including for DELETE, where only a full old record
 * carries the `organization_id` the policy needs. Phase 5.3C is not allowed to
 * take that on faith: an organization-wide topic is only safe if the server
 * filters row delivery, and if it does not, the honest answer is to stop
 * rather than to subscribe and filter in JavaScript.
 *
 * So this drives three sockets against the live project:
 *
 *   1. a member of the organization, who should receive everything
 *   2. an anonymous client, who should receive nothing at all
 *   3. a member subscribed with a server-side filter on organization_id
 *
 * and reports exactly what each one got for INSERT, UPDATE and DELETE.
 *
 *   node scripts/verify-calendar-realtime.mjs
 *
 * Everything it creates is removed again.
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
  console.error('verify-calendar-realtime: missing configuration. See .env / .env.e2e.')
  process.exit(1)
}

let failures = 0
function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
  if (!passed) failures += 1
}

/**
 * One password grant, reused across sockets.
 *
 * Signing in per client trips the hosted auth rate limit, and what delivery
 * depends on is separate sockets rather than separate credentials.
 */
let sharedToken = null

async function signIn() {
  if (sharedToken === null) {
    const client = createClient(url, key, { auth: { persistSession: false } })
    const { data, error } = await client.auth.signInWithPassword({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
    })
    if (error) throw new Error(`sign-in failed: ${error.message}`)
    sharedToken = data.session.access_token
    await client.realtime.setAuth(sharedToken)
    return client
  }
  const attached = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sharedToken}` } },
  })
  await attached.realtime.setAuth(sharedToken)
  return attached
}

/** Resolves with the first event that matches, or null when the window shuts. */
function waitFor(gate, ms = 12_000, matches = () => true) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    gate.resolve = (value) => {
      if (!matches(value)) return
      clearTimeout(timer)
      resolve(value)
    }
  })
}

/** Joins a channel and reports the status the server settled on. */
function joinOnce(channel) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMED_OUT'), 15_000)
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        resolve(err ? `${status}: ${String(err.message ?? err)}` : status)
      }
    })
  })
}

/**
 * The same, with one retry.
 *
 * A socket opening for the first time occasionally misses its join
 * acknowledgement here, and a probe that reports a timeout as a security
 * finding is worse than useless. A second attempt distinguishes a slow
 * handshake from a refusal; a refusal still fails.
 */
async function join(channel) {
  const first = await joinOnce(channel)
  if (first === 'SUBSCRIBED') return first
  await new Promise((resolve) => setTimeout(resolve, 1000))
  return joinOnce(channel)
}

const author = await signIn()
const member = await signIn()
// No sign-in at all: the anon key and nothing else, which is what a stranger
// with the published bundle has.
const stranger = createClient(url, key, { auth: { persistSession: false } })

const { data: orgs } = await author.from('organizations').select('id')
const orgId = orgs[0]?.id
if (!orgId) {
  console.error('verify-calendar-realtime: no organization to schedule in.')
  process.exit(1)
}

const inbox = {
  member: { INSERT: [], UPDATE: [], DELETE: [] },
  stranger: { INSERT: [], UPDATE: [], DELETE: [] },
  filtered: { INSERT: [], UPDATE: [], DELETE: [] },
}
const gates = {
  member: { INSERT: {}, UPDATE: {}, DELETE: {} },
  stranger: { INSERT: {}, UPDATE: {}, DELETE: {} },
  filtered: { INSERT: {}, UPDATE: {}, DELETE: {} },
}

/**
 * An envelope is not a row.
 *
 * A subscriber who may not read the row still receives the event — with empty
 * `new` and `old` and an `errors` entry. Counting envelopes would call that a
 * leak; counting rows is what actually matters, so every arrival is recorded
 * with what it carried.
 */
function listen(client, topic, who, options = {}) {
  let channel = client.channel(topic)
  for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
    channel = channel.on(
      'postgres_changes',
      { event, schema: 'public', table: 'calendar_events', ...options },
      (payload) => {
        const fresh = payload.new && Object.keys(payload.new).length > 0 ? payload.new : null
        const stale = payload.old && Object.keys(payload.old).length > 0 ? payload.old : null
        const row = fresh ?? stale
        inbox[who][event].push({ row, errors: payload.errors ?? null })
        gates[who][event].resolve?.(row)
      },
    )
  }
  return channel
}

/** Every arrival that carried an actual row, rather than an empty envelope. */
const rowsIn = (who, event) => inbox[who][event].filter((entry) => entry.row !== null)

console.log('\n1 · three sockets join a calendar topic')
const memberChannel = listen(member, `calendar:${orgId}`, 'member')
const strangerChannel = listen(stranger, `calendar:${orgId}`, 'stranger')
const filteredChannel = listen(author, `calendar-filtered:${orgId}`, 'filtered', {
  filter: `organization_id=eq.${orgId}`,
})

// One at a time. Three sockets opening at once is a different thing to test
// than three sockets receiving at once, and only the second one matters here.
const memberJoin = await join(memberChannel)
const strangerJoin = await join(strangerChannel)
const filteredJoin = await join(filteredChannel)
check('a member joins the calendar topic', memberJoin === 'SUBSCRIBED', String(memberJoin))
check('an anonymous client joins it too', strangerJoin === 'SUBSCRIBED', String(strangerJoin))
check('a filtered subscription joins', filteredJoin === 'SUBSCRIBED', String(filteredJoin))

// SUBSCRIBED is the join being acknowledged, not the WAL stream being wired
// up. Publishing immediately loses the first event, which looks exactly like
// "the table is not in the publication" and is not.
await new Promise((resolve) => setTimeout(resolve, 2500))

const TITLE = 'Calendar realtime probe'
const DAY = '2031-04-08'

console.log('\n2 · an INSERT reaches the member')
const insertGate = waitFor(gates.member.INSERT, 12_000, (row) => row?.title === TITLE)
const { data: eventId, error: createError } = await author.rpc('create_calendar_event', {
  p_organization_id: orgId,
  p_title: TITLE,
  p_starts_at: `${DAY}T10:00:00.000Z`,
  p_ends_at: `${DAY}T11:00:00.000Z`,
  p_all_day: false,
  p_timezone: 'Asia/Jakarta',
  p_event_type: 'scrim',
  p_location: 'Practice room',
})
check('the event was created', !createError && Boolean(eventId), createError?.message ?? '')
const inserted = await insertGate
check('the member received the INSERT', Boolean(inserted), inserted ? inserted.title : 'nothing')
check(
  'and it carries the organization',
  inserted?.organization_id === orgId,
  inserted?.organization_id ?? '',
)

console.log('\n3 · an UPDATE reaches the member')
const RENAMED = `${TITLE} renamed`
const updateGate = waitFor(gates.member.UPDATE, 12_000, (row) => row?.title === RENAMED)
const { error: updateError } = await author.rpc('update_calendar_event', {
  p_event_id: eventId,
  p_title: RENAMED,
})
check('the event was updated', !updateError, updateError?.message ?? '')
const updated = await updateGate
check('the member received the UPDATE', Boolean(updated), updated ? updated.title : 'nothing')

console.log('\n4 · a DELETE reaches the member, with enough of the old row')
const deleteGate = waitFor(gates.member.DELETE, 12_000, (row) => row?.id === eventId)
const { error: deleteError } = await author.rpc('delete_calendar_event', { p_event_id: eventId })
check('the event was deleted', !deleteError, deleteError?.message ?? '')
const deleted = await deleteGate
check('the member received the DELETE', Boolean(deleted), deleted ? deleted.id : 'nothing')
// Deliberately not asserted as a pass: what the old row carries is the finding
// this script exists to establish, and section 6 reports it either way.
console.log(
  `        the deleted row arrived with: ${deleted ? Object.keys(deleted).join(', ') : 'nothing'}`,
)

console.log('\n5 · the anonymous client received no row at all')
// Everything above has already been published and acknowledged by the member's
// socket. A grace period covers the stranger's socket being a little behind
// rather than actually empty.
await new Promise((resolve) => setTimeout(resolve, 3000))

for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
  const envelopes = inbox.stranger[event]
  const rows = rowsIn('stranger', event)
  check(
    `no ${event} row reached an anonymous subscriber`,
    rows.length === 0,
    `${String(envelopes.length)} envelope(s), ${String(rows.length)} carrying a row`,
  )
}
// The one that would matter most: a DELETE payload could carry the whole old
// row, and with it the title, location and description of a private event.
check(
  'no deleted event body reached anonymous',
  rowsIn('stranger', 'DELETE').every((entry) => !entry.row?.title),
  rowsIn('stranger', 'DELETE')
    .map((entry) => entry.row?.title)
    .join(', '),
)
check(
  'and the empty envelope says it was unauthorized',
  inbox.stranger.INSERT.every((entry) => entry.row === null),
  JSON.stringify(inbox.stranger.INSERT[0]?.errors ?? null),
)

console.log('\n6 · what each event actually carries')
// This decides the subscription's shape. A server-side filter can only match
// on columns the payload carries, and a DELETE arriving as a bare id would
// silently never match one.
for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
  const first = rowsIn('member', event)[0]?.row
  console.log(
    `        member · ${event.padEnd(6)} → ${String(first ? Object.keys(first).length : 0)} column(s): ${
      first ? Object.keys(first).slice(0, 6).join(', ') : 'nothing'
    }`,
  )
}
const deletedColumns = Object.keys(rowsIn('member', 'DELETE')[0]?.row ?? {})
check(
  'a DELETE arrives as a bare id, so no filter can match it',
  deletedColumns.length === 1 && deletedColumns[0] === 'id',
  deletedColumns.join(', '),
)
for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
  const got = rowsIn('filtered', event).length
  console.log(
    `        filter organization_id=eq.<org> · ${event.padEnd(6)} → ${String(got)} row(s)`,
  )
}
console.log(
  `        and its DELETE carried: ${
    Object.keys(rowsIn('filtered', 'DELETE')[0]?.row ?? {}).join(', ') || 'nothing'
  }`,
)
check(
  'a filtered subscription still receives the rows it should',
  rowsIn('filtered', 'INSERT').length > 0 && rowsIn('filtered', 'UPDATE').length > 0,
  `${String(rowsIn('filtered', 'INSERT').length)} INSERT / ${String(rowsIn('filtered', 'UPDATE').length)} UPDATE`,
)


console.log('\ncleanup')
await Promise.all([
  member.removeChannel(memberChannel),
  stranger.removeChannel(strangerChannel),
  author.removeChannel(filteredChannel),
])

// By prefix, so a run that died before its cleanup does not poison the next.
const { data: left } = await author
  .from('calendar_events')
  .select('id')
  .like('title', `${TITLE}%`)
const remaining = (left ?? []).length
if (remaining > 0) {
  for (const row of left) await author.rpc('delete_calendar_event', { p_event_id: row.id })
}
check('no probe event remains', remaining === 0, `${String(remaining)} found`)

await author.auth.signOut({ scope: 'local' })

console.log(
  failures === 0
    ? '\nAll calendar realtime checks passed.\n'
    : `\n${String(failures)} check(s) failed.\n`,
)
const leaked =
  rowsIn('stranger', 'INSERT').length +
  rowsIn('stranger', 'UPDATE').length +
  rowsIn('stranger', 'DELETE').length
if (leaked > 0)
  console.log(
    'An anonymous subscriber received calendar rows. Postgres Changes is NOT\n' +
      'filtering delivery by RLS for this table — an organization-wide topic\n' +
      'would be a leak, and Phase 5.3C must stop rather than subscribe.\n',
  )

process.exit(failures === 0 ? 0 : 1)
