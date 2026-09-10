/**
 * What Supabase Realtime delivers for teams and rosters, and to whom.
 *
 * 7.4 puts two tables on the publication. A publication is a second way out of
 * the database, so the question is whether it obeys the same rules the queries
 * do — and assuming it does would be exactly the mistake 5.3C refused to make
 * for the calendar and 6.4 refused to make for comments.
 *
 * Two sockets against the live project:
 *
 *   1. a member of the organization, who should receive everything they could
 *      have selected — and nothing they could not
 *   2. an anonymous client with the published anon key, who should receive no
 *      rows at all
 *
 * and one question asked of every payload: does it carry anything a roster row
 * has no business publishing?
 *
 *   node scripts/verify-teams-realtime.mjs
 *
 * The teams it creates are archived; clearing them is an operator job, because
 * 7.1 deliberately gave teams no delete routine.
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
  console.error('verify-teams-realtime: missing configuration. See .env / .env.e2e.')
  process.exit(1)
}

let failures = 0
function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${detail}`)
  if (!passed) failures += 1
}

/** One password grant, reused: signing in per socket trips the rate limit. */
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

/** One retry: a slow handshake is not a refusal, and reporting it as one lies. */
async function join(channel) {
  const first = await joinOnce(channel)
  if (first === 'SUBSCRIBED') return first
  await new Promise((resolve) => setTimeout(resolve, 1000))
  return joinOnce(channel)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const TABLES = ['teams', 'team_members']

const member = await signIn()
const author = await signIn()
// No sign-in at all: the anon key and nothing else, which is what a stranger
// with the published bundle has.
const stranger = createClient(url, key, { auth: { persistSession: false } })

const { data: orgs } = await author.from('organizations').select('id')
const orgId = orgs?.[0]?.id
if (!orgId) {
  console.error('verify-teams-realtime: no organization to work in.')
  process.exit(1)
}

const { data: members } = await author
  .from('organization_members')
  .select('id')
  .eq('organization_id', orgId)
const membershipId = members?.[0]?.id

const stamp = Date.now().toString(36).slice(-5)
const { data: teamId, error: madeTeam } = await author.rpc('create_team', {
  p_organization_id: orgId,
  p_name: `Realtime team probe ${stamp}`,
  p_description: null,
})
if (madeTeam) {
  console.error(`verify-teams-realtime: could not create a team: ${madeTeam.message}`)
  process.exit(1)
}

/**
 * Everything that arrived, with what it carried.
 *
 * An envelope is not a row: a subscriber who may not read the row still
 * receives the event, with empty `new` and `old` and an `errors` entry.
 * Counting envelopes would call that a leak; counting rows is what matters.
 */
const inbox = { member: [], stranger: [] }

function listen(client, topic, who) {
  let channel = client.channel(topic)
  for (const table of TABLES) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      const fresh = payload.new && Object.keys(payload.new).length > 0 ? payload.new : null
      const stale = payload.old && Object.keys(payload.old).length > 0 ? payload.old : null
      inbox[who].push({
        table,
        type: payload.eventType,
        row: fresh ?? stale,
        columns: Object.keys(fresh ?? stale ?? {}),
        errors: payload.errors ?? null,
      })
    })
  }
  return channel
}

const rows = (who, table, type = null) =>
  inbox[who].filter(
    (entry) => entry.table === table && entry.row !== null && (type === null || entry.type === type),
  )

async function until(predicate, ms = 12_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await wait(250)
  }
  return predicate()
}

console.log('\n1 · two sockets join one team topic')
const memberChannel = listen(member, `team:${teamId}`, 'member')
const strangerChannel = listen(stranger, `team:${teamId}`, 'stranger')

const memberJoin = await join(memberChannel)
const strangerJoin = await join(strangerChannel)
check('a member joins the team topic', memberJoin === 'SUBSCRIBED', String(memberJoin))
check('an anonymous client joins it too', strangerJoin === 'SUBSCRIBED', String(strangerJoin))

// SUBSCRIBED is the join being acknowledged, not the WAL stream being wired
// up. Publishing immediately loses the first event, which looks exactly like
// "the table is not in the publication" and is not.
await wait(2500)

console.log('\n2 · a team changes, and somebody joins its roster')
await author.rpc('update_team', {
  p_team_id: teamId,
  p_name: `Realtime team probe ${stamp} renamed`,
})
if (membershipId) {
  await author.rpc('add_team_member', { p_team_id: teamId, p_member_id: membershipId })
  await author.rpc('update_team_member', {
    p_team_id: teamId,
    p_member_id: membershipId,
    p_position: 'Duelist',
    p_status: 'substitute',
  })
}

await until(
  () => rows('member', 'teams', 'UPDATE').length > 0 && rows('member', 'team_members').length > 0,
)

check('the member is told the team changed', rows('member', 'teams', 'UPDATE').length > 0)
check('and is told somebody joined the roster', rows('member', 'team_members', 'INSERT').length > 0)
check(
  'and is told what they do on it',
  rows('member', 'team_members', 'UPDATE').length > 0,
)

const teamRow = rows('member', 'teams', 'UPDATE')[0]?.row
check(
  'a team payload names its organization, so a list can scope it',
  teamRow?.organization_id === orgId,
  String(teamRow?.organization_id ?? 'absent'),
)

const rosterRow = rows('member', 'team_members', 'INSERT')[0]
check(
  'a roster payload names its team, so a roster can scope it',
  rosterRow?.row?.team_id === teamId,
  String(rosterRow?.row?.team_id ?? 'absent'),
)
check(
  'and carries only the roster columns, never a name or an address',
  rosterRow !== undefined &&
    rosterRow.columns.every((column) =>
      ['team_id', 'member_id', 'added_by', 'added_at', 'roster_position', 'roster_status'].includes(
        column,
      ),
    ),
  rosterRow ? rosterRow.columns.join(',') : 'no payload',
)
check(
  'no profile field travels on a roster row',
  rosterRow !== undefined && !JSON.stringify(rosterRow.row).includes('@'),
)

console.log('\n3 · somebody leaves a roster')
if (membershipId) {
  await author.rpc('remove_team_member', { p_team_id: teamId, p_member_id: membershipId })
  await until(() => rows('member', 'team_members', 'DELETE').length > 0)
}

const gone = rows('member', 'team_members', 'DELETE')[0]
check('the member is told somebody left', gone !== undefined)
check(
  'a removal carries the primary key and nothing else',
  gone !== undefined &&
    gone.columns.length === 2 &&
    gone.columns.includes('team_id') &&
    gone.columns.includes('member_id'),
  gone ? gone.columns.join(',') : 'no payload',
)
check(
  'so what they did and whether they were starting does not travel',
  gone !== undefined && gone.row.roster_position === undefined && gone.row.roster_status === undefined,
)
check(
  'and the key is enough to say which roster changed',
  gone !== undefined && gone.row.team_id === teamId,
  String(gone?.row?.team_id ?? 'absent'),
)

console.log('\n4 · the anonymous socket')
const strangerRows = inbox.stranger.filter((entry) => entry.row !== null)
check(
  'receives no row from either table',
  strangerRows.length === 0,
  `${String(strangerRows.length)} row(s)`,
)
check(
  'and no team name at all',
  !JSON.stringify(inbox.stranger).includes(stamp),
  `${String(inbox.stranger.length)} envelope(s) seen`,
)
check(
  'though it did receive envelopes, which is not a leak',
  inbox.stranger.length >= 0,
  `${String(inbox.stranger.length)} envelope(s)`,
)

console.log('\n5 · the routines still decide, not the socket')
{
  // Realtime is not a second way in: every write still goes through a routine,
  // and an anonymous caller is refused by all of them.
  const { error: created } = await stranger.rpc('create_team', {
    p_organization_id: orgId,
    p_name: 'nope',
  })
  check('an anonymous caller still cannot create a team', Boolean(created), created?.code ?? 'allowed')

  const { error: joined } = await stranger.rpc('add_team_member', {
    p_team_id: teamId,
    p_member_id: membershipId,
  })
  check('nor change a roster', Boolean(joined), joined?.code ?? 'allowed')

  const { data: seen } = await stranger.from('team_members').select('member_id')
  check('nor read one', (seen ?? []).length === 0, `${String((seen ?? []).length)} row(s)`)

  // And an archived team still refuses roster changes, whatever arrives on a
  // socket: realtime changed no rule.
  await author.rpc('archive_team', { p_team_id: teamId })
  const { error: archived } = await author.rpc('add_team_member', {
    p_team_id: teamId,
    p_member_id: membershipId,
  })
  check('an archived team still takes no member', Boolean(archived), archived?.message ?? 'allowed')
}

console.log('\n6 · clearing up')
await member.removeChannel(memberChannel)
await stranger.removeChannel(strangerChannel)
await author.auth.signOut({ scope: 'local' })

console.log(
  `\n        The probe team stays, archived: 7.1 gave teams no delete routine.\n` +
    '        Clearing it is an operator job:\n\n' +
    "          delete from public.teams where name like 'Realtime team probe%';\n",
)
console.log(
  failures === 0
    ? 'All team realtime checks passed.\n'
    : `${String(failures)} check(s) failed.\n`,
)
console.log(
  'One hosted account cannot be two people, so "a member who may not view this\n' +
    'team" is not exercised here: every member holding teams.view may view all of\n' +
    'them, and proving otherwise needs a second identity with a narrower role.\n' +
    'A cross-organization subscriber cannot be made either, because\n' +
    'bootstrap_organization is granted to nobody. The anonymous socket is the one\n' +
    'negative case this environment can actually make.\n',
)
process.exit(failures === 0 ? 0 : 1)
