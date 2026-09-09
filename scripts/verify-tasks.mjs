/**
 * Tasks, against the live project.
 *
 * The board has a user interface to watch; its rules do not. This drives the
 * routines directly — real calls, real rows, real refusals — and checks the
 * things a screenshot cannot: that an archived project takes nothing new, that
 * a position is the server's to decide, that `completed_at` can never disagree
 * with a column, and that anonymous gets nothing.
 *
 *   node scripts/verify-tasks.mjs
 *
 * Everything it creates is deleted again; the project it works in is archived,
 * because nothing deletes a project by design.
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
  console.error('verify-tasks: missing configuration. See .env / .env.e2e.')
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
  console.error(`verify-tasks: sign-in failed — ${authError.message}`)
  process.exit(1)
}
const me = auth.user.id

const { data: orgs } = await supabase.from('organizations').select('id')
const org = orgs?.[0]?.id
const NOWHERE = '00000000-0000-4000-8000-000000000000'
const TITLE = 'Task probe'

const { data: project, error: projectError } = await supabase.rpc('create_project', {
  p_organization_id: org,
  p_name: `${TITLE} · board`,
  p_status: 'in_progress',
})
if (projectError) {
  console.error(`verify-tasks: could not make a project — ${projectError.message}`)
  process.exit(1)
}

async function add(title, extra = {}) {
  const { data, error } = await supabase.rpc('create_task', {
    p_project_id: project,
    p_title: `${TITLE} · ${title}`,
    ...extra,
  })
  return { id: data, error }
}

async function column(status = 'todo') {
  const { data } = await supabase
    .from('tasks')
    .select('id, title, position, status, completed_at')
    .eq('project_id', project)
    .eq('status', status)
    .order('position')
  return data ?? []
}

console.log('\n1 · the anonymous surface')
{
  const { data: rows } = await anon.from('tasks').select('id')
  check('anonymous reads no tasks', (rows ?? []).length === 0)

  const { error: insert } = await anon
    .from('tasks')
    .insert({ project_id: project, title: 'forged', position: 1 })
  check('anonymous cannot insert one', Boolean(insert), insert?.code ?? '')

  for (const [name, args] of [
    ['create_task', { p_project_id: project, p_title: 'nope' }],
    ['update_task', { p_task_id: NOWHERE, p_title: 'nope' }],
    ['move_task', { p_task_id: NOWHERE, p_status: 'done' }],
    ['assign_task', { p_task_id: NOWHERE, p_assignee_id: null }],
    ['delete_task', { p_task_id: NOWHERE }],
  ]) {
    const { error } = await anon.rpc(name, args)
    check(`nor call ${name}`, Boolean(error), error?.code ?? '')
  }
}

console.log('\n2 · a signed-in member writes only through the routines')
{
  const { id } = await add('read-only')
  const { data: changed } = await supabase
    .from('tasks')
    .update({ status: 'done', position: 1 })
    .eq('id', id)
    .select('id')
  check('a direct UPDATE reaches no row', (changed ?? []).length === 0)

  await supabase.from('tasks').delete().eq('id', id)
  const { data: still } = await supabase.from('tasks').select('status').eq('id', id)
  check('a direct DELETE removes nothing', (still ?? []).length === 1)
  check('and the status is exactly as the routine left it', still?.[0]?.status === 'todo')

  const { error: forged } = await supabase
    .from('tasks')
    .insert({ project_id: project, title: 'forged', position: 1 })
  check('a direct INSERT is refused', Boolean(forged), forged?.code ?? '')

  await supabase.rpc('delete_task', { p_task_id: id })
}

console.log('\n3 · another organization')
{
  const { error } = await supabase.rpc('create_task', {
    p_project_id: NOWHERE,
    p_title: `${TITLE} · elsewhere`,
  })
  check('a task cannot be added to a project that is not there', Boolean(error), error?.code ?? '')

  const { data: rows } = await supabase.from('tasks').select('id').eq('project_id', NOWHERE)
  check('and asking for one returns nothing', (rows ?? []).length === 0)
}

console.log('\n4 · what a task will and will not accept')
{
  const { error: unnamed } = await add('', { p_title: '   ' })
  check('a task needs a title', Boolean(unnamed), unnamed?.message ?? 'accepted')

  const long = await supabase.rpc('create_task', {
    p_project_id: project,
    p_title: 'x'.repeat(201),
  })
  check('and one the column can hold', Boolean(long.error), long.error?.message ?? 'accepted')

  const { error: status } = await add('bad status', { p_status: 'blocked' })
  check('a column this board has', Boolean(status), status?.message ?? 'accepted')

  const { error: priority } = await add('bad priority', { p_priority: 'critical' })
  check('a priority this product has', Boolean(priority), priority?.message ?? 'accepted')
}

console.log('\n5 · where a task lands')
let first = null
let second = null
let third = null
{
  first = (await add('first')).id
  second = (await add('second')).id
  third = (await add('third')).id
  const todo = await column()
  check('three tasks append in order', todo.length === 3)
  check(
    'a thousand apart, as the routine leaves them',
    todo.map((one) => Number(one.position)).join(',') === '1000,2000,3000',
    todo.map((one) => one.position).join(','),
  )

  // Between the first two: the server works out the middle.
  await supabase.rpc('move_task', {
    p_task_id: third,
    p_before_id: first,
    p_after_id: second,
  })
  const reordered = await column()
  check(
    'a task dropped between two lands between them',
    reordered.map((one) => one.id).join(',') === [first, third, second].join(','),
  )
  check('at the midpoint the routine chose', Number(reordered[1].position) === 1500)
}

console.log('\n6 · columns and completion')
{
  const { error } = await supabase.rpc('move_task', { p_task_id: first, p_status: 'done' })
  check('a task moves to Done', !error, error?.message ?? '')

  const done = await column('done')
  check('and is stamped as finished', Boolean(done[0]?.completed_at))

  await supabase.rpc('move_task', { p_task_id: first, p_status: 'review' })
  const review = await column('review')
  check('leaving Done clears the stamp', review[0]?.completed_at === null)

  // Only the routine can write either column, so the two cannot disagree.
  const { data: all } = await supabase
    .from('tasks')
    .select('status, completed_at')
    .eq('project_id', project)
  const consistent = (all ?? []).every((one) =>
    one.status === 'done' ? one.completed_at !== null : one.completed_at === null,
  )
  check('no task on the board disagrees with itself', consistent)
}

console.log('\n7 · a column that has been halved into a corner')
{
  // Twenty-five drops between the same two neighbours halves the gap every
  // time. The routine should notice and renumber rather than run the numbers
  // into the ground.
  for (let i = 0; i < 25; i += 1) {
    await supabase.rpc('move_task', {
      p_task_id: third,
      p_before_id: second,
      p_after_id: null,
    })
    await supabase.rpc('move_task', {
      p_task_id: third,
      p_before_id: null,
      p_after_id: second,
    })
  }
  const todo = await column()
  const positions = todo.map((one) => Number(one.position))
  check('the column still has every task, in one order', todo.length === 2, String(todo.length))
  check(
    'and its numbers are still workable',
    positions.every((one) => Number.isFinite(one)) &&
      Math.abs(positions[1] - positions[0]) > 0.000001,
    positions.join(', '),
  )
}

console.log('\n8 · who a task can be put on')
{
  const { data: members } = await supabase
    .from('organization_members')
    .select('id, user_id')
    .eq('organization_id', org)
  const mine = (members ?? []).find((row) => row.user_id === me)
  const other = (members ?? []).find((row) => row.user_id !== me)

  const { error: nobody } = await supabase.rpc('assign_task', {
    p_task_id: second,
    p_assignee_id: NOWHERE,
  })
  check('somebody who is not in this organization cannot', Boolean(nobody), nobody?.message ?? '')

  const { error: onProject } = await supabase.rpc('assign_task', {
    p_task_id: second,
    p_assignee_id: mine?.id,
  })
  check('somebody on the project can', !onProject, onProject?.message ?? '')

  if (other) {
    // In the organization, but not on this project: refused until they are.
    const { error: offProject } = await supabase.rpc('assign_task', {
      p_task_id: second,
      p_assignee_id: other.id,
    })
    check(
      'somebody in the organization but not on the project cannot',
      Boolean(offProject),
      offProject?.message ?? 'accepted',
    )

    await supabase.rpc('add_project_member', { p_project_id: project, p_member_id: other.id })
    const { error: nowOn } = await supabase.rpc('assign_task', {
      p_task_id: second,
      p_assignee_id: other.id,
    })
    check('and can once they are on it', !nowOn, nowOn?.message ?? '')

    // Taking them off the project puts the task down rather than deleting it.
    await supabase.rpc('remove_project_member', { p_project_id: project, p_member_id: other.id })
    const { data: after } = await supabase
      .from('tasks')
      .select('id, assignee_id')
      .eq('id', second)
    check('taking them off the project clears the assignee', after?.[0]?.assignee_id === null)
    check('and leaves the task where it was', (after ?? []).length === 1)
  } else {
    console.log('        (no second member in this organization to move on and off)')
  }
}

console.log('\n9 · an archived project')
{
  await supabase.rpc('archive_project', { p_project_id: project })

  const { data: rows } = await supabase.from('tasks').select('id').eq('project_id', project)
  check('its tasks are still there, and still readable', (rows ?? []).length > 0)

  const { error: created } = await add('after archiving')
  check('nothing new can be added', Boolean(created), created?.message ?? 'accepted')

  const { error: edited } = await supabase.rpc('update_task', {
    p_task_id: second,
    p_title: 'renamed while archived',
  })
  check('nothing can be edited', Boolean(edited), edited?.message ?? 'accepted')

  const { error: moved } = await supabase.rpc('move_task', {
    p_task_id: second,
    p_status: 'done',
  })
  check('nothing can be moved', Boolean(moved), moved?.message ?? 'accepted')

  const { error: assigned } = await supabase.rpc('assign_task', {
    p_task_id: second,
    p_assignee_id: null,
  })
  check('nothing can be assigned', Boolean(assigned), assigned?.message ?? 'accepted')

  const { error: deleted } = await supabase.rpc('delete_task', { p_task_id: second })
  check('and nothing can be deleted', Boolean(deleted), deleted?.message ?? 'accepted')

  // Bringing the project back is all it takes: no other change anywhere.
  // Since 6.5 that is its own routine — un-archiving was never really an edit.
  await supabase.rpc('restore_project', { p_project_id: project })
  const { error: again } = await supabase.rpc('update_task', {
    p_task_id: second,
    p_title: `${TITLE} · second`,
  })
  check('and it all works again the moment it is restored', !again, again?.message ?? '')
}

console.log('\n10 · audit')
{
  const { data } = await supabase
    .from('audit_logs')
    .select('action, entity_type, actor_id')
    .eq('organization_id', org)
    .eq('entity_type', 'task')
    .order('created_at', { ascending: false })
    .limit(40)

  const actions = new Set((data ?? []).map((row) => row.action))
  for (const action of ['task.created', 'task.updated', 'task.status_changed', 'task.assigned']) {
    check(`${action} is recorded`, actions.has(action))
  }
  check(
    'and the actor is whoever was signed in',
    (data ?? []).every((row) => row.actor_id === me),
  )

  // A reorder inside one column is not an event anybody needs a record of.
  // Counted the same way on both sides, or this compares two questions.
  const statusChanges = async () => {
    const { count } = await supabase
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org)
      .eq('entity_type', 'task')
      .eq('action', 'task.status_changed')
    return count ?? 0
  }

  const before = await statusChanges()
  await supabase.rpc('move_task', { p_task_id: second, p_before_id: third, p_after_id: null })
  const after = await statusChanges()
  check(
    'and a reorder within one column writes none',
    after === before,
    `${String(before)} → ${String(after)}`,
  )
}

console.log('\ncleanup')
{
  const { data: left } = await supabase.from('tasks').select('id').eq('project_id', project)
  for (const row of left ?? []) {
    await supabase.rpc('delete_task', { p_task_id: row.id })
  }
  const { data: remaining } = await supabase.from('tasks').select('id').eq('project_id', project)
  check('every probe task is deleted', (remaining ?? []).length === 0)

  const { data: audits } = await supabase
    .from('audit_logs')
    .select('action')
    .eq('entity_type', 'task')
    .eq('action', 'task.deleted')
    .limit(1)
  check('and the record of deleting them outlives them', (audits ?? []).length > 0)

  // 6.5 gave the application a real delete, so a probe leaves nothing behind.
  await supabase.rpc('delete_project', { p_project_id: project })
  const { data: leftProject } = await supabase.from('projects').select('id').eq('id', project)
  check('and the probe project is deleted', (leftProject ?? []).length === 0)
}

await supabase.auth.signOut({ scope: 'local' })

console.log(
  failures === 0 ? '\nAll task checks passed.\n' : `\n${String(failures)} check(s) failed.\n`,
)
console.log(
  'Refusals for a member who lacks tasks.create, tasks.manage or tasks.assign\n' +
    'cannot be checked from here — the account is the owner, who implicitly holds\n' +
    'everything — and are enforced by has_org_permission in every routine.\n',
)
process.exit(failures === 0 ? 0 : 1)
