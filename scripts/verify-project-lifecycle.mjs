/**
 * The project lifecycle, asked of the live database.
 *
 * Phase 6.5 turns `projects.status` from a label anybody could set into a
 * workflow the database owns. The whole value of that is in what it refuses,
 * so most of what follows is refusals: jumps that skip a stage, completion
 * before a review has run its course, a deadline supplied by the caller,
 * writes to an archived project, and anything at all from a client that has
 * not signed in.
 *
 *   node scripts/verify-project-lifecycle.mjs
 *
 * Everything it creates is deleted again — which this phase can finally do.
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
  console.error('verify-project-lifecycle: missing configuration. See .env / .env.e2e.')
  process.exit(1)
}

let failures = 0
function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${detail}`)
  if (!passed) failures += 1
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const anon = createClient(url, key, { auth: { persistSession: false } })

const { error: signIn } = await supabase.auth.signInWithPassword({
  email: E2E_EMAIL,
  password: E2E_PASSWORD,
})
if (signIn) {
  console.error(`verify-project-lifecycle: sign-in failed: ${signIn.message}`)
  process.exit(1)
}

const { data: orgs } = await supabase.from('organizations').select('id')
const orgId = orgs?.[0]?.id
if (!orgId) {
  console.error('verify-project-lifecycle: no organization to work in.')
  process.exit(1)
}

const stamp = Date.now().toString(36).slice(-5)
const made = []

async function project(name, status = 'planned') {
  const { data, error } = await supabase.rpc('create_project', {
    p_organization_id: orgId,
    p_name: `Lifecycle probe ${name} ${stamp}`,
    p_status: status,
  })
  if (error) throw new Error(`could not create ${name}: ${error.message}`)
  made.push(data)
  return data
}

const move = (id, target, minutes = null, allow = false) =>
  supabase.rpc('transition_project', {
    p_project_id: id,
    p_target: target,
    p_review_duration_minutes: minutes,
    p_allow_unfinished: allow,
  })

const readProject = async (id) => {
  const { data } = await supabase
    .from('projects')
    .select('status, archived_at, review_started_at, review_deadline_at, review_duration_minutes, review_round')
    .eq('id', id)
  return data?.[0] ?? null
}

const refused = (error) => Boolean(error)

console.log('\n1 · a project cannot start where it should arrive')
for (const status of ['in_review', 'done', 'archived']) {
  const { error } = await supabase.rpc('create_project', {
    p_organization_id: orgId,
    p_name: `Lifecycle probe bad ${status} ${stamp}`,
    p_status: status,
  })
  check(`creating one "${status}" is refused`, refused(error), error?.code ?? 'allowed')
}

console.log('\n2 · the stage cannot be set by editing')
{
  const id = await project('edit')
  const { error } = await supabase.rpc('update_project', {
    p_project_id: id,
    p_name: null,
    p_description: null,
    p_status: 'done',
    p_start_date: null,
    p_due_date: null,
    p_clear_start_date: false,
    p_clear_due_date: false,
  })
  // The argument is gone, so PostgREST cannot even find a function to call.
  check('update_project no longer takes a status', refused(error), error?.code ?? 'accepted')
  check('and the project did not move', (await readProject(id))?.status === 'planned')
}

console.log('\n3 · only the four moves')
{
  const id = await project('jumps')
  const jump = async (target) => (await move(id, target)).error
  check('planned → done is refused', refused(await jump('done')))
  check('planned → in_review is refused', refused(await jump('in_review')))
  check('planned → planned is refused', refused(await jump('planned')))
  check('planned → nonsense is refused', refused(await jump('shipped')))

  check('planned → in_progress is allowed', !refused(await jump('in_progress')))
  check('in_progress → done is refused', refused(await jump('done')))
  check('in_progress → planned is refused', refused(await jump('planned')))
  check('the project is in progress', (await readProject(id))?.status === 'in_progress')
}

console.log('\n4 · review is timed by the server')
{
  const id = await project('review')
  await move(id, 'in_progress')

  const { error: silly } = await move(id, 'in_review', 90)
  check('an unsupported review length is refused', refused(silly), silly?.code ?? 'accepted')

  const before = Date.now()
  check('sending to review is allowed', !refused((await move(id, 'in_review', 60)).error))

  const row = await readProject(id)
  const deadline = row?.review_deadline_at ? Date.parse(row.review_deadline_at) : 0
  const expected = before + 60 * 60 * 1000
  check('the stage is in_review', row?.status === 'in_review')
  check('a review start was recorded', Boolean(row?.review_started_at))
  check('the deadline is an hour away, from the server clock',
    Math.abs(deadline - expected) < 90_000,
    `${String(Math.round((deadline - expected) / 1000))}s from expected`)
  check('the round is 1', row?.review_round === 1, String(row?.review_round))

  const { error: early } = await move(id, 'done')
  check('completing before the deadline is refused', refused(early), early?.message ?? 'allowed')
}

console.log('\n5 · asking for changes keeps the history')
{
  const id = await project('changes')
  await move(id, 'in_progress')
  await move(id, 'in_review', 60)

  const { data: said, error: saidError } = await supabase.rpc('create_project_review_comment', {
    p_project_id: id,
    p_body: 'The third clip is out of sync.',
  })
  check('a review comment can be written', !refused(saidError), saidError?.message ?? '')

  check('in_review → in_progress is allowed', !refused((await move(id, 'in_progress')).error))
  const row = await readProject(id)
  check('the deadline is cleared', row?.review_deadline_at === null)
  check('the review start is cleared', row?.review_started_at === null)
  check('the round is kept, so history stays readable', row?.review_round === 1)

  const { data: kept } = await supabase
    .from('project_review_comments')
    .select('id, body, review_round')
    .eq('project_id', id)
  check('the review comment survived', kept?.length === 1, `${String(kept?.length ?? 0)} comment(s)`)
  // Said while the first review was running, so it belongs to round 1. A
  // comment written before any review at all would carry 0, which is what
  // "never been reviewed" counts as.
  check('and remembers which round it was said in', kept?.[0]?.review_round === 1,
    `round ${String(kept?.[0]?.review_round)}`)

  await move(id, 'in_review', 60)
  check('a second review is round 2', (await readProject(id))?.review_round === 2)

  const { data: second } = await supabase.rpc('create_project_review_comment', {
    p_project_id: id,
    p_body: 'Better.',
  })
  const { data: rounds } = await supabase
    .from('project_review_comments')
    .select('review_round')
    .eq('project_id', id)
    .order('created_at')
  check('the two rounds are distinguishable',
    JSON.stringify((rounds ?? []).map((r) => r.review_round)) === '[1,2]',
    JSON.stringify((rounds ?? []).map((r) => r.review_round)))

  // Deleting one takes the words somewhere no client may look.
  await supabase.rpc('delete_project_review_comment', { p_comment_id: second })
  const { data: gone } = await supabase
    .from('project_review_comments')
    .select('id, body, deleted_at')
    .eq('id', second)
  check('a deleted comment keeps its row and loses its words',
    gone?.[0]?.body === '' && gone?.[0]?.deleted_at !== null)

  const { error: peek } = await supabase
    .from('project_review_comments')
    .select('deleted_body')
    .eq('id', second)
  check('deleted_body cannot be selected by any client', refused(peek), peek?.code ?? 'readable')
  void said
}

console.log('\n6 · unfinished work, and a review with no limit')
{
  const id = await project('unfinished')
  await move(id, 'in_progress')

  const { data: taskId } = await supabase.rpc('create_task', {
    p_project_id: id,
    p_title: 'Something still open',
  })
  await move(id, 'in_review', null)

  const row = await readProject(id)
  check('no limit means no deadline', row?.review_deadline_at === null)
  check('and no duration is stored', row?.review_duration_minutes === null)

  const { error: blocked } = await move(id, 'done')
  check('completing with open work is refused', refused(blocked), blocked?.message ?? 'allowed')
  check('the message says how many', /1 task/.test(blocked?.message ?? ''), blocked?.message ?? '')

  const { error: forced } = await move(id, 'done', null, true)
  check('completing is allowed when the caller says so', !refused(forced), forced?.message ?? '')
  check('the project is done', (await readProject(id))?.status === 'done')

  const { error: again } = await move(id, 'in_progress')
  check('done is terminal', refused(again), again?.message ?? 'allowed')
  void taskId
}

console.log('\n7 · archived is a state, not a stage')
{
  const id = await project('archived')
  await move(id, 'in_progress')
  await move(id, 'in_review', 60)
  check('archiving is allowed', !refused((await supabase.rpc('archive_project', { p_project_id: id })).error))

  const row = await readProject(id)
  check('the stage is left where it was', row?.status === 'in_review', String(row?.status))
  check('and the archive is recorded separately', row?.archived_at !== null)

  check('an archived project cannot be moved along', refused((await move(id, 'in_progress')).error))
  check('an archived project takes no review comment', refused(
    (await supabase.rpc('create_project_review_comment', { p_project_id: id, p_body: 'hello' })).error))
  check('an archived project takes no task', refused(
    (await supabase.rpc('create_task', { p_project_id: id, p_title: 'nope' })).error))
  check('an archived project takes no edit', refused(
    (await supabase.rpc('update_project', { p_project_id: id, p_name: 'renamed' })).error))
  check('archiving twice is refused', refused(
    (await supabase.rpc('archive_project', { p_project_id: id })).error))

  check('restoring is allowed', !refused((await supabase.rpc('restore_project', { p_project_id: id })).error))
  const back = await readProject(id)
  check('and it comes back exactly where it was', back?.status === 'in_review' && back?.archived_at === null,
    String(back?.status))
  check('restoring twice is refused', refused(
    (await supabase.rpc('restore_project', { p_project_id: id })).error))
}

console.log('\n8 · who is working on it')
{
  const id = await project('workers')
  await move(id, 'in_progress')

  const { data: members } = await supabase
    .from('organization_members')
    .select('id')
    .eq('organization_id', orgId)
    .limit(1)
  const me = members?.[0]?.id

  const open = await supabase.rpc('create_task', { p_project_id: id, p_title: 'Open work' })
  const shut = await supabase.rpc('create_task', { p_project_id: id, p_title: 'Finished work' })
  await supabase.rpc('assign_task', { p_task_id: open.data, p_assignee_id: me })
  await supabase.rpc('assign_task', { p_task_id: shut.data, p_assignee_id: me })

  const overviewFor = async (projectId) => {
    const { data, error } = await supabase.rpc('project_overview', { p_organization_id: orgId })
    if (error) throw new Error(error.message)
    return (data ?? []).find((row) => row.project_id === projectId)
  }

  let row = await overviewFor(id)
  check('the overview counts the tasks', row?.total_tasks === 2, String(row?.total_tasks))
  check('and nobody has finished anything yet', row?.done_tasks === 0, String(row?.done_tasks))
  check('the assignee is working on it', (row?.workers ?? []).length === 1,
    `${String((row?.workers ?? []).length)} worker(s)`)
  check('with a name to draw', Boolean(row?.workers?.[0]?.display_name ?? row?.workers?.[0]?.email))
  check('and a count of what is open', row?.workers?.[0]?.open_tasks === 2,
    String(row?.workers?.[0]?.open_tasks))

  await supabase.rpc('move_task', { p_task_id: shut.data, p_status: 'done' })
  row = await overviewFor(id)
  check('a finished task counts as done', row?.done_tasks === 1, String(row?.done_tasks))
  check('and stops counting towards their open work', row?.workers?.[0]?.open_tasks === 1,
    String(row?.workers?.[0]?.open_tasks))

  await supabase.rpc('move_task', { p_task_id: open.data, p_status: 'done' })
  row = await overviewFor(id)
  check('somebody whose work is all finished is not working on it',
    (row?.workers ?? []).length === 0, `${String((row?.workers ?? []).length)} worker(s)`)
  check('though the project still has its members',
    ((await supabase.from('project_members').select('member_id').eq('project_id', id)).data ?? [])
      .length > 0)
}

console.log('\n9 · a client that has not signed in')
{
  const id = made[made.length - 1]
  const denied = async (name, args) => {
    const { error } = await anon.rpc(name, args)
    check(`${name} refuses an anonymous caller`, refused(error), error?.code ?? 'allowed')
  }
  await denied('transition_project', { p_project_id: id, p_target: 'done' })
  await denied('archive_project', { p_project_id: id })
  await denied('restore_project', { p_project_id: id })
  await denied('delete_project', { p_project_id: id })
  await denied('create_project_review_comment', { p_project_id: id, p_body: 'hello' })
  await denied('project_overview', { p_organization_id: orgId })

  const { data: seen } = await anon.from('project_review_comments').select('id')
  check('and reads no review comment at all', (seen ?? []).length === 0,
    `${String((seen ?? []).length)} row(s)`)
}

console.log('\n10 · deleting, which is not archiving')
{
  const id = await project('doomed')
  await move(id, 'in_progress')
  const { data: task } = await supabase.rpc('create_task', { p_project_id: id, p_title: 'Doomed work' })
  await supabase.rpc('create_task_comment', { p_task_id: task, p_body: 'Something about it' })
  const { data: label } = await supabase.rpc('create_label', {
    p_project_id: id, p_name: `doomed-${stamp}`, p_color: 'brass',
  })
  await supabase.rpc('assign_label', { p_task_id: task, p_label_id: label })
  await supabase.rpc('create_project_review_comment', { p_project_id: id, p_body: 'A review note' })

  const { error } = await supabase.rpc('delete_project', { p_project_id: id })
  check('deleting is allowed', !refused(error), error?.message ?? '')

  const left = async (table, column, value) =>
    ((await supabase.from(table).select(column).eq(column === 'id' ? 'id' : column, value)).data ?? []).length

  check('the project is gone',
    ((await supabase.from('projects').select('id').eq('id', id)).data ?? []).length === 0)
  check('its tasks went with it',
    ((await supabase.from('tasks').select('id').eq('project_id', id)).data ?? []).length === 0)
  check('its labels went with it',
    ((await supabase.from('project_labels').select('id').eq('project_id', id)).data ?? []).length === 0)
  check('its task comments went with it',
    ((await supabase.from('task_comments').select('id').eq('task_id', task)).data ?? []).length === 0)
  check('its review comments went with it',
    ((await supabase.from('project_review_comments').select('id').eq('project_id', id)).data ?? [])
      .length === 0)
  check('its roster went with it',
    ((await supabase.from('project_members').select('member_id').eq('project_id', id)).data ?? [])
      .length === 0)

  const { data: record } = await supabase
    .from('audit_logs')
    .select('action, entity_id')
    .eq('entity_id', id)
    .eq('action', 'project.deleted')
  check('and the record of it survived', (record ?? []).length === 1,
    `${String((record ?? []).length)} entry`)
  void left
}

console.log('\n11 · clearing up')
// By name rather than by what this run made, so an earlier run that fell over
// half way through is swept up too. Deleting a project is finally something
// this application can do, so nothing needs to be left archived.
{
  const { data: mine } = await supabase
    .from('projects')
    .select('id')
    .like('name', 'Lifecycle probe%')
  for (const row of mine ?? []) {
    await supabase.rpc('delete_project', { p_project_id: row.id })
  }
}
void made
const { data: leftovers } = await supabase
  .from('projects')
  .select('id')
  .like('name', 'Lifecycle probe%')
check('every probe project is deleted', (leftovers ?? []).length === 0,
  `${String((leftovers ?? []).length)} left`)

await supabase.auth.signOut({ scope: 'local' })

console.log(
  failures === 0
    ? '\nAll project lifecycle checks passed.\n'
    : `\n${String(failures)} check(s) failed.\n`,
)
console.log(
  'One hosted account cannot be two people, so "a member without projects.manage\n' +
    'is refused a transition" is not exercised here: the only credential this\n' +
    'environment has holds every project permission. The anonymous client is the\n' +
    'one negative identity available, and it is refused by every routine above.\n',
)
process.exit(failures === 0 ? 0 : 1)
