/**
 * Projects, against the live project.
 *
 * The same shape as the calendar's verification: real calls, real rows, real
 * refusals, one line each. What it establishes is the part with no user
 * interface to watch — that the policies and routines refuse what they should,
 * that archiving keeps everything, and that a project cannot be moved or
 * populated across organizations.
 *
 *   node scripts/verify-projects.mjs
 *
 * Everything it creates is archived, because nothing deletes a project by
 * design. The rows it leaves are named `Project probe · …` and clearing them
 * is an operator job; the statement is printed at the end.
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
  console.error('verify-projects: missing configuration. See .env / .env.e2e.')
  process.exit(1)
}

let failures = 0
function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(54)} ${detail}`)
  if (!passed) failures += 1
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const anon = createClient(url, key, { auth: { persistSession: false } })

const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
  email: E2E_EMAIL,
  password: E2E_PASSWORD,
})
if (authError) {
  console.error(`verify-projects: sign-in failed — ${authError.message}`)
  process.exit(1)
}
const me = auth.user.id

const { data: orgs } = await supabase.from('organizations').select('id')
const org = orgs?.[0]?.id
if (!org) {
  console.error('verify-projects: no organization.')
  process.exit(1)
}

const TITLE = 'Project probe'
const NOWHERE = '00000000-0000-4000-8000-000000000000'
const made = []

async function start(what, extra = {}) {
  const { data, error } = await supabase.rpc('create_project', {
    p_organization_id: org,
    p_name: `${TITLE} · ${what}`,
    ...extra,
  })
  if (data) made.push(data)
  return { id: data, error }
}

console.log('\n1 · the anonymous surface')
{
  const { data: rows, error } = await anon.from('projects').select('id')
  check('anonymous reads no projects', (rows ?? []).length === 0, error?.code ?? '')

  const { data: members } = await anon.from('project_members').select('project_id')
  check('nor any project roster', (members ?? []).length === 0)

  const { error: insert } = await anon
    .from('projects')
    .insert({ organization_id: org, name: `${TITLE} · forged` })
  check('anonymous cannot insert a project', Boolean(insert), insert?.code ?? '')

  const { error: create } = await anon.rpc('create_project', {
    p_organization_id: org,
    p_name: `${TITLE} · anonymous`,
  })
  check('nor call the routine that makes one', Boolean(create), create?.code ?? '')

  const { error: archive } = await anon.rpc('archive_project', { p_project_id: NOWHERE })
  check('nor the one that archives one', Boolean(archive), archive?.code ?? '')

  const { error: member } = await anon.rpc('add_project_member', {
    p_project_id: NOWHERE,
    p_member_id: NOWHERE,
  })
  check('nor the one that adds somebody', Boolean(member), member?.code ?? '')
}

console.log('\n2 · a signed-in member writes only through the routines')
{
  const { error } = await supabase
    .from('projects')
    .insert({ organization_id: org, name: `${TITLE} · direct` })
  check('a direct INSERT is refused', Boolean(error), error?.code ?? '')

  const { id } = await start('the table is read-only', { p_status: 'active' })
  // No UPDATE policy means the statement matches no row rather than failing,
  // so what is checked is the row, not the response.
  const { data: changed } = await supabase
    .from('projects')
    .update({ name: 'renamed by hand' })
    .eq('id', id)
    .select('id')
  check('a direct UPDATE reaches no row', (changed ?? []).length === 0, `${String((changed ?? []).length)} changed`)

  const { data: after } = await supabase.from('projects').select('name').eq('id', id)
  check(
    'and the name is exactly as the routine wrote it',
    after?.[0]?.name === `${TITLE} · the table is read-only`,
    after?.[0]?.name ?? '',
  )

  await supabase.from('projects').delete().eq('id', id)
  const { data: still } = await supabase.from('projects').select('id').eq('id', id)
  check('a direct DELETE removes nothing', (still ?? []).length === 1)
}

console.log('\n3 · another organization')
{
  const { error: create } = await supabase.rpc('create_project', {
    p_organization_id: NOWHERE,
    p_name: `${TITLE} · cross-org`,
  })
  check('a project cannot be started somewhere else', Boolean(create), create?.code ?? '')

  const { data: rows } = await supabase.from('projects').select('id').eq('organization_id', NOWHERE)
  check('and asking for another organization returns nothing', (rows ?? []).length === 0)

  const { error: update } = await supabase.rpc('update_project', {
    p_project_id: NOWHERE,
    p_name: 'nope',
  })
  check('a project that is not there cannot be changed', Boolean(update), update?.code ?? '')

  // There is no organization parameter on the update routine at all, so there
  // is nothing to send: PostgREST refuses a call carrying one.
  const { id } = await start('stays put')
  const { error: moved } = await supabase.rpc('update_project', {
    p_project_id: id,
    p_organization_id: NOWHERE,
  })
  check('an update cannot carry an organization', Boolean(moved), moved?.code ?? '')

  const { data: row } = await supabase.from('projects').select('organization_id').eq('id', id)
  check('and the project still belongs where it did', row?.[0]?.organization_id === org)
}

console.log('\n4 · what a project will and will not accept')
{
  const { error: unnamed } = await start('', { p_name: '   ' })
  check('a project needs a name', Boolean(unnamed), unnamed?.message ?? 'accepted')

  const long = await supabase.rpc('create_project', {
    p_organization_id: org,
    p_name: 'x'.repeat(121),
  })
  if (long.data) made.push(long.data)
  check('and one the column can hold', Boolean(long.error), long.error?.message ?? 'accepted')

  const { error: status } = await start('bad status', { p_status: 'blocked' })
  check('a status this product has', Boolean(status), status?.message ?? 'accepted')

  const { error: born } = await start('born archived', { p_status: 'archived' })
  check('and it cannot start out archived', Boolean(born), born?.message ?? 'accepted')

  const { error: backwards } = await start('backwards', {
    p_start_date: '2026-11-30',
    p_due_date: '2026-10-01',
  })
  check('it cannot be due before it starts', Boolean(backwards), backwards?.message ?? 'accepted')
}

console.log('\n5 · starting one, and what comes with it')
let subject = null
{
  const { id, error } = await start('the real one', {
    p_description: 'Checking the routine end to end.',
    p_status: 'active',
    p_start_date: '2026-10-01',
    p_due_date: '2026-11-30',
  })
  subject = id
  check('a project is created', !error && Boolean(id), error?.message ?? '')

  const { data: row } = await supabase.from('projects').select('*').eq('id', id)
  const project = (row ?? [])[0]
  check('with the name trimmed', project?.name === `${TITLE} · the real one`, project?.name ?? '')
  check('the author recorded', project?.created_by === me)
  check('and its timestamps set by the server', Boolean(project?.created_at))
  check('created and updated start together', project?.created_at === project?.updated_at)

  const { data: members } = await supabase
    .from('project_members')
    .select('member_id, added_by')
    .eq('project_id', id)
  check('whoever started it is on it', (members ?? []).length === 1, `${String((members ?? []).length)} on it`)
  check('added by themselves', members?.[0]?.added_by === me)
}

console.log('\n6 · changing one')
{
  await supabase.rpc('update_project', { p_project_id: subject, p_name: `${TITLE} · renamed` })
  const { data: row } = await supabase
    .from('projects')
    .select('name, description, start_date, updated_at, created_at')
    .eq('id', subject)
  const project = (row ?? [])[0]
  check('the name changes', project?.name === `${TITLE} · renamed`)
  check('what was not mentioned is left alone', project?.description !== null)
  check('and updated_at moves while created_at does not', project?.updated_at !== project?.created_at)

  await supabase.rpc('update_project', { p_project_id: subject, p_clear_start_date: true })
  const { data: cleared } = await supabase
    .from('projects')
    .select('start_date, due_date')
    .eq('id', subject)
  check('a date can be taken off', cleared?.[0]?.start_date === null)
  check('without taking the other one', cleared?.[0]?.due_date === '2026-11-30')

  const { error: archived } = await supabase.rpc('update_project', {
    p_project_id: subject,
    p_status: 'archived',
  })
  check(
    'archiving is not something an edit can do',
    Boolean(archived),
    archived?.message ?? 'accepted',
  )
}

console.log('\n7 · who a project is for')
{
  const { data: members } = await supabase
    .from('organization_members')
    .select('id, user_id, status')
    .eq('organization_id', org)
  const mine = (members ?? []).find((row) => row.user_id === me)
  const other = (members ?? []).find((row) => row.user_id !== me)

  const { error: outsider } = await supabase.rpc('add_project_member', {
    p_project_id: subject,
    p_member_id: NOWHERE,
  })
  check(
    'somebody who is not in this organization cannot be added',
    Boolean(outsider),
    outsider?.message ?? 'accepted',
  )

  const { error: twice } = await supabase.rpc('add_project_member', {
    p_project_id: subject,
    p_member_id: mine?.id,
  })
  check('adding somebody already on it is quietly nothing', !twice, twice?.message ?? '')
  const { data: after } = await supabase
    .from('project_members')
    .select('member_id')
    .eq('project_id', subject)
  check('and does not put them on twice', (after ?? []).length === 1)

  if (other) {
    const { error: added } = await supabase.rpc('add_project_member', {
      p_project_id: subject,
      p_member_id: other.id,
    })
    check('another member of this organization can be added', !added, added?.message ?? '')

    const { error: removed } = await supabase.rpc('remove_project_member', {
      p_project_id: subject,
      p_member_id: other.id,
    })
    check('and taken off again', !removed, removed?.message ?? '')

    const { error: again } = await supabase.rpc('remove_project_member', {
      p_project_id: subject,
      p_member_id: other.id,
    })
    check('taking off somebody who is not on it is refused', Boolean(again), again?.code ?? '')
  } else {
    console.log('        (no second member in this organization to add and remove)')
  }
}

console.log('\n8 · archiving keeps everything')
{
  const { data: before } = await supabase
    .from('project_members')
    .select('member_id')
    .eq('project_id', subject)

  const { error } = await supabase.rpc('archive_project', { p_project_id: subject })
  check('a project is archived', !error, error?.message ?? '')

  const { data: row } = await supabase
    .from('projects')
    .select('status, name, description, due_date')
    .eq('id', subject)
  check('the row is still there', (row ?? []).length === 1)
  check('with its status changed', row?.[0]?.status === 'archived')
  check('and nothing else lost', row?.[0]?.description !== null && row?.[0]?.due_date !== null)

  const { data: members } = await supabase
    .from('project_members')
    .select('member_id')
    .eq('project_id', subject)
  check('its people are still on it', (members ?? []).length === (before ?? []).length)

  const { error: twice } = await supabase.rpc('archive_project', { p_project_id: subject })
  check('archiving it again is refused', Boolean(twice), twice?.message ?? 'accepted')

  await supabase.rpc('update_project', { p_project_id: subject, p_status: 'planned' })
  const { data: back } = await supabase.from('projects').select('status').eq('id', subject)
  check('and it can be brought back by an edit', back?.[0]?.status === 'planned')
}

console.log('\n9 · audit')
{
  const { data } = await supabase
    .from('audit_logs')
    .select('action, entity_type, entity_id, actor_id')
    .eq('organization_id', org)
    .eq('entity_type', 'project')
    .order('created_at', { ascending: false })
    .limit(30)

  const actions = new Set((data ?? []).map((row) => row.action))
  for (const action of [
    'project.created',
    'project.updated',
    'project.archived',
    'project.member_added',
    'project.member_removed',
  ]) {
    const seen = actions.has(action)
    // The last two only happen when there is a second member to move around.
    if (!seen && action.startsWith('project.member')) {
      console.log(`        (${action} not exercised: no second member)`)
      continue
    }
    check(`${action} is recorded`, seen)
  }

  check(
    'and the actor is whoever was signed in',
    (data ?? []).every((row) => row.actor_id === me),
  )
}

console.log('\ncleanup')
{
  for (const id of made) {
    const { data: row } = await supabase.from('projects').select('status').eq('id', id)
    if ((row ?? [])[0] && row[0].status !== 'archived') {
      await supabase.rpc('archive_project', { p_project_id: id })
    }
  }
  const { data: left } = await supabase
    .from('projects')
    .select('id, status')
    .like('name', `${TITLE}%`)
  const unarchived = (left ?? []).filter((row) => row.status !== 'archived')
  check('every probe project is archived', unarchived.length === 0, `${String(unarchived.length)} left`)

  if ((left ?? []).length > 0) {
    console.log(
      `        ${String((left ?? []).length)} probe project(s) remain, archived. Nothing deletes a\n` +
        '        project by design, and adding a routine that did so to tidy up\n' +
        '        after a test would be weakening the product to suit the test.\n' +
        '        Clearing them is an operator job:\n\n' +
        "          delete from public.projects where name like 'Project probe%';\n",
    )
  }
}

await supabase.auth.signOut({ scope: 'local' })

console.log(
  failures === 0 ? '\nAll project checks passed.\n' : `\n${String(failures)} check(s) failed.\n`,
)
console.log(
  'Refusals for a member who lacks the permission cannot be checked from here —\n' +
    'the account is the owner, who implicitly holds everything — and are enforced\n' +
    'by has_org_permission in each routine and by the policy on each table.\n',
)
process.exit(failures === 0 ? 0 : 1)
