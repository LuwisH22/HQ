/**
 * Labels and comments, against the live project.
 *
 * What has no user interface to watch: that a label cannot cross a project,
 * that a deleted comment's words are unreachable by any client, that deleting
 * a task leaves no orphans, and that anonymous gets none of it.
 *
 *   node scripts/verify-labels-comments.mjs
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
  console.error('verify-labels-comments: missing configuration. See .env / .env.e2e.')
  process.exit(1)
}

let failures = 0
function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${detail}`)
  if (!passed) failures += 1
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const anon = createClient(url, key, { auth: { persistSession: false } })

const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
  email: E2E_EMAIL,
  password: E2E_PASSWORD,
})
if (authError) {
  console.error(`verify-labels-comments: sign-in failed — ${authError.message}`)
  process.exit(1)
}
const me = auth.user.id

const { data: orgs } = await supabase.from('organizations').select('id')
const org = orgs?.[0]?.id
const NOWHERE = '00000000-0000-4000-8000-000000000000'
const TITLE = 'Label probe'

const { data: project } = await supabase.rpc('create_project', {
  p_organization_id: org,
  p_name: `${TITLE} · board`,
  p_status: 'in_progress',
})
const { data: other } = await supabase.rpc('create_project', {
  p_organization_id: org,
  p_name: `${TITLE} · elsewhere`,
  p_status: 'in_progress',
})
const { data: task } = await supabase.rpc('create_task', {
  p_project_id: project,
  p_title: `${TITLE} · a task`,
})

console.log('\n1 · the anonymous surface')
{
  for (const [table] of [['project_labels'], ['task_labels'], ['task_comments']]) {
    const { data } = await anon.from(table).select('*')
    check(`anonymous reads no ${table}`, (data ?? []).length === 0)
  }

  for (const [name, args] of [
    ['create_label', { p_project_id: project, p_name: 'forged' }],
    ['update_label', { p_label_id: NOWHERE, p_name: 'forged' }],
    ['delete_label', { p_label_id: NOWHERE }],
    ['assign_label', { p_task_id: task, p_label_id: NOWHERE }],
    ['remove_label', { p_task_id: task, p_label_id: NOWHERE }],
    ['create_task_comment', { p_task_id: task, p_body: 'forged' }],
    ['update_task_comment', { p_comment_id: NOWHERE, p_body: 'forged' }],
    ['delete_task_comment', { p_comment_id: NOWHERE }],
  ]) {
    const { error } = await anon.rpc(name, args)
    check(`anonymous cannot call ${name}`, Boolean(error), error?.code ?? '')
  }
}

console.log('\n2 · what a label will and will not be')
let label = null
{
  const made = await supabase.rpc('create_label', {
    p_project_id: project,
    p_name: '  Scrim  ',
    p_color: 'violet',
    p_description: 'Anything played against another team.',
  })
  label = made.data
  check('a label is created', !made.error && Boolean(label), made.error?.message ?? '')

  const { data: row } = await supabase.from('project_labels').select('*').eq('id', label)
  check('with its name trimmed', row?.[0]?.name === 'Scrim', row?.[0]?.name ?? '')
  check('and the colour it was given', row?.[0]?.color === 'violet')

  const { error: dup } = await supabase.rpc('create_label', {
    p_project_id: project,
    p_name: 'scrim',
  })
  check('the same name twice is refused, whatever its case', Boolean(dup), dup?.message ?? '')

  const { error: unnamed } = await supabase.rpc('create_label', {
    p_project_id: project,
    p_name: '   ',
  })
  check('a label needs a name', Boolean(unnamed), unnamed?.message ?? '')

  const { error: long } = await supabase.rpc('create_label', {
    p_project_id: project,
    p_name: 'x'.repeat(41),
  })
  check('and one the column can hold', Boolean(long), long?.message ?? '')

  const { error: colour } = await supabase.rpc('create_label', {
    p_project_id: project,
    p_name: 'Injected',
    p_color: 'url(javascript:alert(1))',
  })
  check(
    'a colour is one of six tokens, not anything a client types',
    Boolean(colour),
    colour?.message ?? 'accepted',
  )
}

console.log('\n3 · a label belongs to its project')
{
  const { data: elsewhere } = await supabase.rpc('create_label', {
    p_project_id: other,
    p_name: 'Somewhere else',
  })

  const { error } = await supabase.rpc('assign_label', {
    p_task_id: task,
    p_label_id: elsewhere,
  })
  check(
    'another project label cannot go on this task',
    Boolean(error),
    error?.message ?? 'accepted',
  )

  const { data: rows } = await supabase.from('task_labels').select('label_id').eq('task_id', task)
  check('and nothing was written', (rows ?? []).length === 0)

  // The trigger says the same thing, whatever route is taken.
  const { error: direct } = await supabase
    .from('task_labels')
    .insert({ task_id: task, label_id: elsewhere })
  check('nor by writing to the table directly', Boolean(direct), direct?.code ?? '')
}

console.log('\n4 · putting one on and taking it off')
{
  const { error } = await supabase.rpc('assign_label', { p_task_id: task, p_label_id: label })
  check('a label goes on', !error, error?.message ?? '')

  const { error: twice } = await supabase.rpc('assign_label', { p_task_id: task, p_label_id: label })
  const { data: rows } = await supabase.from('task_labels').select('label_id').eq('task_id', task)
  check('putting it on twice is quietly nothing', !twice && (rows ?? []).length === 1)

  const { error: off } = await supabase.rpc('remove_label', { p_task_id: task, p_label_id: label })
  check('and it comes off again', !off, off?.message ?? '')

  const { error: again } = await supabase.rpc('remove_label', {
    p_task_id: task,
    p_label_id: label,
  })
  check('taking off one that is not on it is refused', Boolean(again), again?.code ?? '')

  await supabase.rpc('assign_label', { p_task_id: task, p_label_id: label })
}

console.log('\n5 · comments')
let comment = null
{
  const made = await supabase.rpc('create_task_comment', {
    p_task_id: task,
    p_body: '  Booked for Thursday.  ',
  })
  comment = made.data
  check('a comment is written', !made.error && Boolean(comment), made.error?.message ?? '')

  const { data: rows } = await supabase
    .from('task_comments')
    .select('id, body, author_id, deleted_at')
    .eq('id', comment)
  check('trimmed, and attributed to whoever wrote it', rows?.[0]?.body === 'Booked for Thursday.')
  check('by the caller, not by anything the caller sent', rows?.[0]?.author_id === me)

  const { error: empty } = await supabase.rpc('create_task_comment', {
    p_task_id: task,
    p_body: '   ',
  })
  check('a comment needs something in it', Boolean(empty), empty?.message ?? '')

  const { error: long } = await supabase.rpc('create_task_comment', {
    p_task_id: task,
    p_body: 'x'.repeat(4001),
  })
  check('and one the column can hold', Boolean(long), long?.message ?? '')

  const { error: edited } = await supabase.rpc('update_task_comment', {
    p_comment_id: comment,
    p_body: 'Booked for Friday.',
  })
  check('its author may edit it', !edited, edited?.message ?? '')

  const { data: after } = await supabase
    .from('task_comments')
    .select('body, created_at, updated_at')
    .eq('id', comment)
  check('and the edit shows', after?.[0]?.body === 'Booked for Friday.')
  check('with updated_at moved on', after?.[0]?.updated_at !== after?.[0]?.created_at)
}

console.log('\n6 · a deleted comment keeps its place and loses its words')
{
  const { error } = await supabase.rpc('delete_task_comment', { p_comment_id: comment })
  check('a comment is deleted', !error, error?.message ?? '')

  const { data: rows } = await supabase
    .from('task_comments')
    .select('id, body, deleted_at, deleted_by')
    .eq('id', comment)
  check('the row is still there', (rows ?? []).length === 1)
  check('its body is empty', rows?.[0]?.body === '')
  check('and it says who removed it, and when', rows?.[0]?.deleted_by === me && Boolean(rows?.[0]?.deleted_at))

  // The words are in the row; no client has the privilege to ask for them.
  const { error: peek } = await supabase
    .from('task_comments')
    .select('deleted_body')
    .eq('id', comment)
  check('the words cannot be selected', Boolean(peek), peek?.code ?? 'READABLE')

  const { error: star } = await supabase.from('task_comments').select('*').eq('id', comment)
  check('and asking for the whole row is refused too', Boolean(star), star?.code ?? 'READABLE')

  const { error: anonPeek } = await anon.from('task_comments').select('deleted_body')
  check('anonymous cannot ask either', Boolean(anonPeek), anonPeek?.code ?? 'READABLE')

  const { error: twice } = await supabase.rpc('delete_task_comment', { p_comment_id: comment })
  check('deleting it twice is refused', Boolean(twice), twice?.message ?? '')

  const { error: editGone } = await supabase.rpc('update_task_comment', {
    p_comment_id: comment,
    p_body: 'back again',
  })
  check('and a deleted comment cannot be edited back', Boolean(editGone), editGone?.message ?? '')
}

console.log('\n7 · an archived project')
{
  await supabase.rpc('archive_project', { p_project_id: project })

  const { data: labels } = await supabase.from('project_labels').select('id').eq('project_id', project)
  check('its labels are still readable', (labels ?? []).length > 0)

  const { error: newLabel } = await supabase.rpc('create_label', {
    p_project_id: project,
    p_name: 'After archiving',
  })
  check('no new label can be made', Boolean(newLabel), newLabel?.message ?? 'accepted')

  const { error: assign } = await supabase.rpc('assign_label', {
    p_task_id: task,
    p_label_id: label,
  })
  check('nothing can be labelled', Boolean(assign), assign?.message ?? 'accepted')

  const { error: said } = await supabase.rpc('create_task_comment', {
    p_task_id: task,
    p_body: 'anything',
  })
  check('and nothing can be said', Boolean(said), said?.message ?? 'accepted')

  await supabase.rpc('restore_project', { p_project_id: project })
  const { error: again } = await supabase.rpc('create_task_comment', {
    p_task_id: task,
    p_body: 'Back again.',
  })
  check('restoring the project brings it all back', !again, again?.message ?? '')
}

console.log('\n8 · deleting a task, and deleting a label')
{
  const { data: doomed } = await supabase.rpc('create_task', {
    p_project_id: project,
    p_title: `${TITLE} · doomed`,
  })
  await supabase.rpc('assign_label', { p_task_id: doomed, p_label_id: label })
  await supabase.rpc('create_task_comment', { p_task_id: doomed, p_body: 'Something.' })

  await supabase.rpc('delete_task', { p_task_id: doomed })

  const { data: labelRows } = await supabase
    .from('task_labels')
    .select('task_id')
    .eq('task_id', doomed)
  const { data: commentRows } = await supabase
    .from('task_comments')
    .select('id')
    .eq('task_id', doomed)
  check('deleting a task leaves no label rows behind', (labelRows ?? []).length === 0)
  check('and no comments behind', (commentRows ?? []).length === 0)

  const { data: audit } = await supabase
    .from('audit_logs')
    .select('action')
    .eq('entity_type', 'task')
    .eq('entity_id', doomed)
    .eq('action', 'task.deleted')
  check('while the record of it outlives the row', (audit ?? []).length === 1)

  // A label is a word about work, not the work: removing it takes it off
  // every task and deletes nothing else.
  const { data: spare } = await supabase.rpc('create_label', {
    p_project_id: project,
    p_name: 'Temporary',
  })
  await supabase.rpc('assign_label', { p_task_id: task, p_label_id: spare })
  await supabase.rpc('delete_label', { p_label_id: spare })

  const { data: stillThere } = await supabase.from('tasks').select('id').eq('id', task)
  const { data: gone } = await supabase.from('task_labels').select('label_id').eq('label_id', spare)
  check('deleting a label leaves the tasks it was on', (stillThere ?? []).length === 1)
  check('and takes only its own rows', (gone ?? []).length === 0)
}

console.log('\n9 · audit')
{
  const { data } = await supabase
    .from('audit_logs')
    .select('action, actor_id, metadata')
    .eq('organization_id', org)
    .in('action', [
      'project.label_created',
      'project.label_updated',
      'project.label_deleted',
      'task.label_added',
      'task.label_removed',
      'task.comment_created',
      'task.comment_updated',
      'task.comment_deleted',
    ])
    .order('created_at', { ascending: false })
    .limit(40)

  const actions = new Set((data ?? []).map((row) => row.action))
  for (const action of [
    'project.label_created',
    'project.label_deleted',
    'task.label_added',
    'task.label_removed',
    'task.comment_created',
    'task.comment_updated',
    'task.comment_deleted',
  ]) {
    check(`${action} is recorded`, actions.has(action))
  }
  check(
    'the actor is whoever was signed in',
    (data ?? []).every((row) => row.actor_id === me),
  )
  // The words are not in the audit trail: more people can read that than can
  // read the task it belongs to.
  check(
    'and no comment body was written into it',
    (data ?? []).every((row) => !JSON.stringify(row.metadata ?? {}).includes('Booked for')),
  )
}

console.log('\ncleanup')
{
  for (const id of [project, other]) {
    const { data: tasks } = await supabase.from('tasks').select('id').eq('project_id', id)
    for (const row of tasks ?? []) await supabase.rpc('delete_task', { p_task_id: row.id })
    const { data: state } = await supabase.from('projects').select('status').eq('id', id)
    if (state?.[0]?.status !== 'archived') {
      await supabase.rpc('archive_project', { p_project_id: id })
    }
  }
  const { data: left } = await supabase.from('tasks').select('id').eq('project_id', project)
  check('every probe task is deleted', (left ?? []).length === 0)
  console.log(
    '        The probe projects stay, archived: nothing deletes a project by\n' +
      '        design. Clearing them is an operator job:\n\n' +
      "          delete from public.projects where name like 'Label probe%';\n",
  )
}

await supabase.auth.signOut({ scope: 'local' })

console.log(
  failures === 0
    ? '\nAll label and comment checks passed.\n'
    : `\n${String(failures)} check(s) failed.\n`,
)
console.log(
  'One account cannot be two people, so "somebody else\u2019s comment" is not\n' +
    'exercised here: editing and deleting another member\u2019s words needs\n' +
    'tasks.manage, which the owner holds, and a second identity to prove it on.\n',
)
process.exit(failures === 0 ? 0 : 1)
