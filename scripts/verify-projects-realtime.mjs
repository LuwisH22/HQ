/**
 * What Supabase Realtime delivers for a project, and to whom.
 *
 * Phase 6.4 subscribes six tables, and two of the six carry things that must
 * not travel to the wrong socket: what people say about a task, and — since
 * 6.3 — the words of a comment that has been taken back, which live in
 * `deleted_body`, a column no client is granted. A publication is a second way
 * out of the database, so the question is whether it obeys the same rules the
 * queries do. Assuming it does would be exactly the mistake 5.3C refused to
 * make for the calendar.
 *
 * Two sockets against the live project:
 *
 *   1. a member of the organization, who should receive everything they could
 *      have selected — and nothing they could not
 *   2. an anonymous client with the published anon key, who should receive no
 *      rows at all
 *
 * and one question asked of every payload that arrives: does it carry a column
 * this subscriber may not read?
 *
 *   node scripts/verify-projects-realtime.mjs
 *
 * The tasks, labels and comments it creates are removed. The project stays,
 * archived: nothing deletes a project by design.
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
  console.error('verify-projects-realtime: missing configuration. See .env / .env.e2e.')
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

const TABLES = [
  'projects',
  'project_members',
  'tasks',
  'project_labels',
  'task_labels',
  'task_comments',
]

const member = await signIn()
const author = await signIn()
// No sign-in at all: the anon key and nothing else, which is what a stranger
// with the published bundle has.
const stranger = createClient(url, key, { auth: { persistSession: false } })

const { data: orgs } = await author.from('organizations').select('id')
const orgId = orgs?.[0]?.id
if (!orgId) {
  console.error('verify-projects-realtime: no organization to work in.')
  process.exit(1)
}

const stamp = Date.now().toString(36).slice(-5)
const { data: projectId, error: projectError } = await author.rpc('create_project', {
  p_organization_id: orgId,
  p_name: `Realtime probe ${stamp}`,
  p_description: null,
  p_status: 'in_progress',
  p_start_date: null,
  p_due_date: null,
})
if (projectError) {
  console.error(`verify-projects-realtime: could not create a project: ${projectError.message}`)
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
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        const fresh = payload.new && Object.keys(payload.new).length > 0 ? payload.new : null
        const stale = payload.old && Object.keys(payload.old).length > 0 ? payload.old : null
        inbox[who].push({
          table,
          type: payload.eventType,
          row: fresh ?? stale,
          columns: Object.keys(fresh ?? stale ?? {}),
          errors: payload.errors ?? null,
        })
      },
    )
  }
  return channel
}

/** Every arrival for a table that carried an actual row. */
const rows = (who, table, type = null) =>
  inbox[who].filter(
    (entry) => entry.table === table && entry.row !== null && (type === null || entry.type === type),
  )

/** Wait until something matching turns up, or give up. */
async function until(predicate, ms = 12_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await wait(250)
  }
  return predicate()
}

console.log('\n1 · two sockets join one project topic')
const memberChannel = listen(member, `project:${projectId}`, 'member')
const strangerChannel = listen(stranger, `project:${projectId}`, 'stranger')

const memberJoin = await join(memberChannel)
const strangerJoin = await join(strangerChannel)
check('a member joins the project topic', memberJoin === 'SUBSCRIBED', String(memberJoin))
check('an anonymous client joins it too', strangerJoin === 'SUBSCRIBED', String(strangerJoin))

// SUBSCRIBED is the join being acknowledged, not the WAL stream being wired
// up. Publishing immediately loses the first event, which looks exactly like
// "the table is not in the publication" and is not.
await wait(2500)

console.log('\n2 · a task, a label and a comment are written')
const { data: taskId } = await author.rpc('create_task', {
  p_project_id: projectId,
  p_title: `Probe task ${stamp}`,
  p_description: null,
  p_status: 'todo',
  p_priority: 'none',
  p_assignee_id: null,
  p_due_date: null,
})
const { data: labelId } = await author.rpc('create_label', {
  p_project_id: projectId,
  p_name: `probe-${stamp}`,
  p_color: 'brass',
})
await author.rpc('assign_label', { p_task_id: taskId, p_label_id: labelId })

// The phrase that must never reach a socket that may not read it, and must
// never survive being taken back.
const SECRET = `SECRET-${stamp}-DO-NOT-TRAVEL`
const { data: commentId } = await author.rpc('create_task_comment', {
  p_task_id: taskId,
  p_body: SECRET,
})

await until(() => rows('member', 'tasks', 'INSERT').length > 0 && rows('member', 'task_comments', 'INSERT').length > 0)

check('the member is told a task was created', rows('member', 'tasks', 'INSERT').length > 0)
check('the member is told a label was created', rows('member', 'project_labels', 'INSERT').length > 0)
check('the member is told a label was put on it', rows('member', 'task_labels', 'INSERT').length > 0)
check('the member is told a comment was written', rows('member', 'task_comments', 'INSERT').length > 0)

const taskRow = rows('member', 'tasks', 'INSERT')[0]?.row
check(
  'a task payload names its project, so a board can scope it',
  taskRow?.project_id === projectId,
  String(taskRow?.project_id ?? 'absent'),
)
const labelLink = rows('member', 'task_labels', 'INSERT')[0]?.row
check(
  'a task_labels payload names no project, as the code assumes',
  labelLink !== undefined && labelLink.project_id === undefined,
  labelLink ? Object.keys(labelLink).join(',') : 'absent',
)

console.log('\n3 · the anonymous socket')
const strangerRows = inbox.stranger.filter((entry) => entry.row !== null)
check('receives no row from any of the six tables', strangerRows.length === 0, `${String(strangerRows.length)} row(s)`)
check(
  'receives no comment body at all',
  !JSON.stringify(inbox.stranger).includes(SECRET),
  `${String(inbox.stranger.length)} envelope(s) seen`,
)

console.log('\n4 · a comment taken back')
await author.rpc('delete_task_comment', { p_comment_id: commentId })
await until(() => rows('member', 'task_comments', 'UPDATE').length > 0)

const soft = rows('member', 'task_comments', 'UPDATE')[0]
check('the member is told the comment changed', soft !== undefined)
check(
  'the payload does not carry deleted_body',
  soft !== undefined && !soft.columns.includes('deleted_body'),
  soft ? soft.columns.join(',') : 'no payload',
)
check(
  'the words themselves do not travel',
  soft !== undefined && !JSON.stringify(soft.row).includes(SECRET),
  soft ? `body=${JSON.stringify(soft.row.body)}` : 'no payload',
)
check(
  'realtime delivers exactly the columns a client may select',
  soft !== undefined &&
    soft.columns.every((column) =>
      ['id', 'task_id', 'author_id', 'body', 'deleted_at', 'deleted_by', 'created_at', 'updated_at'].includes(column),
    ),
  soft ? soft.columns.join(',') : 'no payload',
)

console.log('\n5 · a deletion')
await author.rpc('delete_task', { p_task_id: taskId })
await until(() => rows('member', 'tasks', 'DELETE').length > 0)

const gone = rows('member', 'tasks', 'DELETE')[0]
check('the member is told the task was deleted', gone !== undefined)
check(
  'a deletion carries the primary key and nothing else',
  gone !== undefined && gone.columns.length === 1 && gone.columns[0] === 'id',
  gone ? gone.columns.join(',') : 'no payload',
)
check(
  'so a deleted task cannot be attributed to a project from the payload alone',
  gone !== undefined && gone.row.project_id === undefined,
)

console.log('\n6 · the project itself')
await author.rpc('update_project', {
  p_project_id: projectId,
  p_name: `Realtime probe ${stamp} renamed`,
  p_description: null,
  p_status: null,
  p_start_date: null,
  p_due_date: null,
  p_clear_start_date: false,
  p_clear_due_date: false,
})
await until(() => rows('member', 'projects', 'UPDATE').length > 0)

const renamed = rows('member', 'projects', 'UPDATE')[0]?.row
check('the member is told the project changed', renamed !== undefined)
check(
  'a project payload names its organization, so a list can scope it',
  renamed?.organization_id === orgId,
  String(renamed?.organization_id ?? 'absent'),
)

console.log('\n7 · clearing up')
await member.removeChannel(memberChannel)
await stranger.removeChannel(strangerChannel)

const { data: leftTasks } = await author.from('tasks').select('id').eq('project_id', projectId)
for (const row of leftTasks ?? []) await author.rpc('delete_task', { p_task_id: row.id })
await author.rpc('delete_label', { p_label_id: labelId })
await author.rpc('archive_project', { p_project_id: projectId })

const { data: after } = await author.from('tasks').select('id').eq('project_id', projectId)
check('every probe task is gone', (after ?? []).length === 0)

await author.auth.signOut({ scope: 'local' })

console.log(
  '\n        The probe project stays, archived: nothing deletes a project by\n' +
    '        design. Clearing it is an operator job:\n\n' +
    "          delete from public.projects where name like 'Realtime probe%';\n",
)
console.log(
  failures === 0
    ? 'All project realtime checks passed.\n'
    : `${String(failures)} check(s) failed.\n`,
)
console.log(
  'One hosted account cannot be two people, so "a member who may not view this\n' +
    'project" is not exercised here: every member of this organization who may\n' +
    'view projects may view all of them, and proving otherwise needs a second\n' +
    'identity with a narrower role. The anonymous socket is the one negative\n' +
    'case this environment can actually make.\n',
)
process.exit(failures === 0 ? 0 : 1)
