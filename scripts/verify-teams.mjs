/**
 * Teams, asked of the live database.
 *
 * 7.1 is foundation: there is no interface to click, so this is the whole of
 * the phase's evidence. Most of it is refusals — an archived team taking an
 * edit, a suspended member joining a roster, an anonymous caller doing
 * anything at all — because what a foundation is worth is what it will not let
 * happen once there is a screen on top of it.
 *
 * The one claim worth more than the rest: putting somebody on a team grants
 * them nothing and taking them off revokes nothing. That is checked by asking
 * `has_org_permission` the same questions before, during and after.
 *
 *   node scripts/verify-teams.mjs
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
  console.error('verify-teams: missing configuration. See .env / .env.e2e.')
  process.exit(1)
}

let failures = 0
function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${detail}`)
  if (!passed) failures += 1
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const anon = createClient(url, key, { auth: { persistSession: false } })

const { data: session, error: signIn } = await supabase.auth.signInWithPassword({
  email: E2E_EMAIL,
  password: E2E_PASSWORD,
})
if (signIn) {
  console.error(`verify-teams: sign-in failed: ${signIn.message}`)
  process.exit(1)
}

// Straight from the grant rather than from a second round trip: `getUser()`
// is one more request that can come back empty, and everything below compares
// against this id.
const me = session.user.id

const { data: orgs } = await supabase.from('organizations').select('id')
const orgId = orgs?.[0]?.id
if (!orgId) {
  console.error('verify-teams: no organization to work in.')
  process.exit(1)
}

const { data: members } = await supabase
  .from('organization_members')
  .select('id, user_id, status')
  .eq('organization_id', orgId)

const myMembership = (members ?? []).find((row) => row.user_id === me)?.id
const someoneElse = (members ?? []).find((row) => row.user_id !== me)

const stamp = Date.now().toString(36).slice(-5)
const NAME = `Team probe ${stamp}`

const refused = (error) => Boolean(error)

async function team(what, description = null) {
  const { data, error } = await supabase.rpc('create_team', {
    p_organization_id: orgId,
    p_name: `${NAME} ${what}`,
    p_description: description,
  })
  if (error) throw new Error(`could not create ${what}: ${error.message}`)
  return data
}

const rosterOf = async (teamId) => {
  const { data } = await supabase.from('team_members').select('member_id').eq('team_id', teamId)
  return (data ?? []).map((row) => row.member_id)
}

const rowOf = async (teamId) => {
  const { data } = await supabase
    .from('teams')
    .select('name, description, archived_at, organization_id, created_by')
    .eq('id', teamId)
  return data?.[0] ?? null
}

console.log('\n1 · making a team')
{
  const { error: unnamed } = await supabase.rpc('create_team', {
    p_organization_id: orgId,
    p_name: '   ',
  })
  check('a team needs a name', refused(unnamed), unnamed?.code ?? 'accepted')

  const { error: long } = await supabase.rpc('create_team', {
    p_organization_id: orgId,
    p_name: 'x'.repeat(81),
  })
  check('and a name of a sensible length', refused(long), long?.code ?? 'accepted')

  const { error: wordy } = await supabase.rpc('create_team', {
    p_organization_id: orgId,
    p_name: `${NAME} wordy`,
    p_description: 'x'.repeat(2001),
  })
  check('and a description of one', refused(wordy), wordy?.code ?? 'accepted')

  const id = await team('main', '  The Valorant side.  ')
  const row = await rowOf(id)
  check('a team is created', row !== null)
  check('its name is trimmed', row?.name === `${NAME} main`, String(row?.name))
  check('and so is its description', row?.description === 'The Valorant side.')
  check('it belongs to this organization', row?.organization_id === orgId)
  check('it is not archived', row?.archived_at === null)
  check('and its author is recorded', row?.created_by === me,
    `${String(row?.created_by)} vs ${String(me)}`)

  // Deliberately empty: a manager writing down that the organization has a
  // side is not thereby on it, and adding them would be a roster write made
  // without the roster permission.
  check('the roster starts empty', (await rosterOf(id)).length === 0)
}

console.log('\n2 · changing one')
{
  const id = await team('editable', 'First words.')

  const { error } = await supabase.rpc('update_team', { p_team_id: id, p_name: `${NAME} renamed` })
  check('a team can be renamed', !refused(error), error?.message ?? '')
  let row = await rowOf(id)
  check('the name changed', row?.name === `${NAME} renamed`)
  check('and what was left out was left alone', row?.description === 'First words.')

  await supabase.rpc('update_team', { p_team_id: id, p_description: '  Second words. ' })
  row = await rowOf(id)
  check('the description can be changed on its own', row?.description === 'Second words.')
  check('without touching the name', row?.name === `${NAME} renamed`)

  await supabase.rpc('update_team', { p_team_id: id, p_description: '' })
  row = await rowOf(id)
  check('and cleared by saying so', row?.description === null)

  const { error: missing } = await supabase.rpc('update_team', {
    p_team_id: '00000000-0000-4000-8000-000000000000',
    p_name: 'nowhere',
  })
  check('a team that does not exist is not found', refused(missing), missing?.code ?? 'accepted')
}

console.log('\n3 · putting one away')
{
  const id = await team('archivable')
  if (myMembership) await supabase.rpc('add_team_member', { p_team_id: id, p_member_id: myMembership })

  check('a team is archived', !refused((await supabase.rpc('archive_team', { p_team_id: id })).error))
  const row = await rowOf(id)
  check('the row stays', row !== null)
  check('and says when it was put away', row?.archived_at !== null)
  check('its roster is kept', (await rosterOf(id)).length === (myMembership ? 1 : 0))

  check('archiving it twice is refused', refused(
    (await supabase.rpc('archive_team', { p_team_id: id })).error))
  check('an archived team takes no edit', refused(
    (await supabase.rpc('update_team', { p_team_id: id, p_name: 'nope' })).error))
  check('an archived team takes no new member', refused(
    (await supabase.rpc('add_team_member', { p_team_id: id, p_member_id: myMembership })).error))
  check('and no roster removal either', refused(
    (await supabase.rpc('remove_team_member', { p_team_id: id, p_member_id: myMembership })).error))

  check('it can be restored', !refused((await supabase.rpc('restore_team', { p_team_id: id })).error))
  const back = await rowOf(id)
  check('and is the same team, not a new one', back?.archived_at === null && back?.name === row?.name)
  check('with the roster it was put away with',
    (await rosterOf(id)).length === (myMembership ? 1 : 0))
  check('restoring it twice is refused', refused(
    (await supabase.rpc('restore_team', { p_team_id: id })).error))
}

console.log('\n4 · the roster')
{
  const id = await team('roster')
  if (!myMembership) {
    console.log('        (this account has no membership row to put on a roster)')
  } else {
    const { error } = await supabase.rpc('add_team_member', {
      p_team_id: id,
      p_member_id: myMembership,
    })
    check('a member is added', !refused(error), error?.message ?? '')
    check('and is on the roster', (await rosterOf(id)).includes(myMembership))

    // The primary key makes it impossible; the routine makes it quiet.
    const { error: twice } = await supabase.rpc('add_team_member', {
      p_team_id: id,
      p_member_id: myMembership,
    })
    check('adding them again is not an error', !refused(twice), twice?.message ?? '')
    check('and does not put them on twice', (await rosterOf(id)).length === 1)

    const { error: gone } = await supabase.rpc('remove_team_member', {
      p_team_id: id,
      p_member_id: myMembership,
    })
    check('a member is removed', !refused(gone), gone?.message ?? '')
    check('and taking the last one off is allowed', (await rosterOf(id)).length === 0)

    const { error: again } = await supabase.rpc('remove_team_member', {
      p_team_id: id,
      p_member_id: myMembership,
    })
    check('removing somebody who is not on it is quiet', !refused(again))

    // Still a member of the organization: a roster is not a membership.
    const { data: still } = await supabase
      .from('organization_members')
      .select('id')
      .eq('id', myMembership)
    check('and they are still in the organization', (still ?? []).length === 1)
  }

  const { error: nobody } = await supabase.rpc('add_team_member', {
    p_team_id: id,
    p_member_id: '00000000-0000-4000-8000-000000000000',
  })
  check('somebody who does not exist cannot be added', refused(nobody), nobody?.code ?? 'accepted')
}

console.log('\n5 · a roster is not a permission')
{
  // The whole of "membership is context", asked of the thing that decides.
  const asked = ['teams.view', 'teams.manage', 'teams.roster_manage', 'projects.manage']
  // Somewhere this account is not. Without a question that answers false the
  // whole snapshot would be a row of `true`s — an owner is allowed everything,
  // including permission keys that do not exist — and comparing two rows of
  // `true` would prove nothing about whether a roster can change an answer.
  const NOWHERE = '00000000-0000-4000-8000-000000000000'

  const snapshot = async () => {
    const out = {}
    for (const permission of asked) {
      const { data } = await supabase.rpc('has_org_permission', {
        p_organization_id: orgId,
        p_permission: permission,
      })
      out[permission] = data
    }
    const { data: elsewhere } = await supabase.rpc('has_org_permission', {
      p_organization_id: NOWHERE,
      p_permission: 'teams.view',
    })
    out['teams.view elsewhere'] = elsewhere
    return JSON.stringify(out)
  }

  const id = await team('context')
  const before = await snapshot()

  if (myMembership) {
    await supabase.rpc('add_team_member', { p_team_id: id, p_member_id: myMembership })
    const during = await snapshot()
    check('being put on a team grants nothing', during === before, during)

    await supabase.rpc('remove_team_member', { p_team_id: id, p_member_id: myMembership })
    const after = await snapshot()
    check('and being taken off revokes nothing', after === before, after)
  }

  // Nothing anywhere reads the roster to decide anything: the two policies in
  // this migration ask has_org_permission and nothing else.
  check(
    'the questions had both answers in them',
    before.includes('true') && before.includes('false'),
    before,
  )
}

console.log('\n6 · somebody who is not active')
{
  const id = await team('inactive')

  if (!someoneElse) {
    console.log('        (this organization has only one member, so nobody can be suspended)')
  } else {
    const { error: suspended } = await supabase.rpc('suspend_member', {
      p_member_id: someoneElse.id,
      p_reason: 'Teams foundation probe',
      p_days: 1,
    })
    check('a member can be suspended for the test', !refused(suspended), suspended?.message ?? '')

    const { error } = await supabase.rpc('add_team_member', {
      p_team_id: id,
      p_member_id: someoneElse.id,
    })
    check('a suspended member cannot join a roster', refused(error), error?.message ?? 'accepted')
    check('and is not on it', !(await rosterOf(id)).includes(someoneElse.id))

    // Put them back exactly as they were, whatever happened above.
    const { error: lifted } = await supabase.rpc('unsuspend_member', {
      p_member_id: someoneElse.id,
      p_reason: 'Teams foundation probe finished',
    })
    check('the suspension is lifted again', !refused(lifted), lifted?.message ?? '')

    const { error: now } = await supabase.rpc('add_team_member', {
      p_team_id: id,
      p_member_id: someoneElse.id,
    })
    check('and then they can join', !refused(now), now?.message ?? '')
    await supabase.rpc('remove_team_member', { p_team_id: id, p_member_id: someoneElse.id })
  }
}

console.log('\n6b · what somebody does on a team')
{
  const id = await team('positions')
  if (!myMembership) {
    console.log('        (no membership row to put on a roster)')
  } else {
    await supabase.rpc('add_team_member', { p_team_id: id, p_member_id: myMembership })

    const read = async () => {
      const { data } = await supabase
        .from('team_members')
        .select('roster_position, roster_status')
        .eq('team_id', id)
        .eq('member_id', myMembership)
      return data?.[0] ?? null
    }

    let row = await read()
    check(
      'somebody added starts as active with no position',
      row?.roster_status === 'active' && row?.roster_position === null,
      `${String(row?.roster_status)} / ${String(row?.roster_position)}`,
    )

    const { error } = await supabase.rpc('update_team_member', {
      p_team_id: id,
      p_member_id: myMembership,
      p_position: '  Duelist  ',
      p_status: 'substitute',
    })
    check('a position and a status can be set', !refused(error), error?.message ?? '')

    row = await read()
    check('the position is trimmed', row?.roster_position === 'Duelist', String(row?.roster_position))
    check('and the status is stored', row?.roster_status === 'substitute')

    // Null leaves a column alone, as everywhere else in this schema.
    await supabase.rpc('update_team_member', {
      p_team_id: id,
      p_member_id: myMembership,
      p_status: 'inactive',
    })
    row = await read()
    check('changing the status leaves the position alone', row?.roster_position === 'Duelist')
    check('and the status changed', row?.roster_status === 'inactive')

    await supabase.rpc('update_team_member', {
      p_team_id: id,
      p_member_id: myMembership,
      p_clear_position: true,
    })
    row = await read()
    check('a position can be taken off by saying so', row?.roster_position === null)

    const { error: nonsense } = await supabase.rpc('update_team_member', {
      p_team_id: id,
      p_member_id: myMembership,
      p_status: 'benched',
    })
    check('an unknown status is refused', refused(nonsense), nonsense?.code ?? 'accepted')

    const { error: long } = await supabase.rpc('update_team_member', {
      p_team_id: id,
      p_member_id: myMembership,
      p_position: 'x'.repeat(41),
    })
    check('an unreasonable position is refused', refused(long), long?.code ?? 'accepted')

    const { error: stranger } = await supabase.rpc('update_team_member', {
      p_team_id: id,
      p_member_id: '00000000-0000-4000-8000-000000000000',
      p_status: 'active',
    })
    check('somebody not on the roster cannot be edited', refused(stranger), stranger?.code ?? 'accepted')

    // The whole of "operational only", asked of the thing that decides.
    const permission = async () => {
      const { data } = await supabase.rpc('has_org_permission', {
        p_organization_id: orgId,
        p_permission: 'teams.manage',
      })
      return data
    }
    const before = await permission()
    await supabase.rpc('update_team_member', {
      p_team_id: id,
      p_member_id: myMembership,
      p_status: 'inactive',
    })
    check('a roster status grants and revokes nothing', (await permission()) === before, String(before))

    await supabase.rpc('archive_team', { p_team_id: id })
    const { error: archived } = await supabase.rpc('update_team_member', {
      p_team_id: id,
      p_member_id: myMembership,
      p_status: 'active',
    })
    check('an archived team takes no roster change', refused(archived), archived?.message ?? 'accepted')
    await supabase.rpc('restore_team', { p_team_id: id })
  }
}

console.log('\n6c · moving somebody between teams')
{
  const from = await team('from')
  const to = await team('to')

  if (!myMembership) {
    console.log('        (no membership row to move)')
  } else {
    await supabase.rpc('add_team_member', { p_team_id: from, p_member_id: myMembership })
    await supabase.rpc('update_team_member', {
      p_team_id: from,
      p_member_id: myMembership,
      p_position: 'Analyst',
      p_status: 'substitute',
    })

    const { error: itself } = await supabase.rpc('move_team_member', {
      p_from_team_id: from,
      p_to_team_id: from,
      p_member_id: myMembership,
    })
    check('moving somebody to the team they are on is refused', refused(itself), itself?.message ?? 'accepted')

    const { error } = await supabase.rpc('move_team_member', {
      p_from_team_id: from,
      p_to_team_id: to,
      p_member_id: myMembership,
    })
    check('a member is moved', !refused(error), error?.message ?? '')

    check('they are off the team they left', !(await rosterOf(from)).includes(myMembership))
    check('and on the one they went to', (await rosterOf(to)).includes(myMembership))

    const { data: carried } = await supabase
      .from('team_members')
      .select('roster_position, roster_status')
      .eq('team_id', to)
      .eq('member_id', myMembership)
    check('what they do travelled with them', carried?.[0]?.roster_position === 'Analyst')
    check('and so did whether they were starting', carried?.[0]?.roster_status === 'substitute')

    const { error: again } = await supabase.rpc('move_team_member', {
      p_from_team_id: from,
      p_to_team_id: to,
      p_member_id: myMembership,
    })
    check('moving somebody who is not on the source is refused', refused(again), again?.message ?? 'accepted')

    await supabase.rpc('add_team_member', { p_team_id: from, p_member_id: myMembership })
    const { error: both } = await supabase.rpc('move_team_member', {
      p_from_team_id: from,
      p_to_team_id: to,
      p_member_id: myMembership,
    })
    check('moving onto a team they are already on is refused', refused(both), both?.message ?? 'accepted')
    check(
      'and both rosters are left as they were',
      (await rosterOf(from)).includes(myMembership) && (await rosterOf(to)).includes(myMembership),
    )

    await supabase.rpc('archive_team', { p_team_id: to })
    const { error: archived } = await supabase.rpc('move_team_member', {
      p_from_team_id: from,
      p_to_team_id: to,
      p_member_id: myMembership,
    })
    check('moving onto an archived team is refused', refused(archived), archived?.message ?? 'accepted')
    await supabase.rpc('restore_team', { p_team_id: to })
  }
}

console.log('\n7 · a client that has not signed in')
{
  const id = await team('locked')
  const denied = async (name, args) => {
    const { error } = await anon.rpc(name, args)
    check(`${name} refuses an anonymous caller`, refused(error), error?.code ?? 'allowed')
  }

  await denied('create_team', { p_organization_id: orgId, p_name: 'nope' })
  await denied('update_team', { p_team_id: id, p_name: 'nope' })
  await denied('archive_team', { p_team_id: id })
  await denied('restore_team', { p_team_id: id })
  await denied('add_team_member', { p_team_id: id, p_member_id: myMembership })
  await denied('remove_team_member', { p_team_id: id, p_member_id: myMembership })
  await denied('update_team_member', {
    p_team_id: id,
    p_member_id: myMembership,
    p_status: 'active',
  })
  await denied('move_team_member', {
    p_from_team_id: id,
    p_to_team_id: id,
    p_member_id: myMembership,
  })
  await denied('team_organization', { p_team_id: id })

  const { data: seenTeams } = await anon.from('teams').select('id')
  check('and reads no team at all', (seenTeams ?? []).length === 0,
    `${String((seenTeams ?? []).length)} row(s)`)
  const { data: seenRoster } = await anon.from('team_members').select('member_id')
  check('nor any roster', (seenRoster ?? []).length === 0,
    `${String((seenRoster ?? []).length)} row(s)`)
}

console.log('\n7b · the tables themselves')
{
  // Every write in this schema goes through a routine, so the tables must
  // refuse one made directly — by a signed-in member, not just by a stranger.
  // RLS carries this: there is no insert, update or delete policy on either
  // table, so there is nothing for a privilege to satisfy.
  const id = await team('direct')

  const { error: inserted } = await supabase
    .from('teams')
    .insert({ organization_id: orgId, name: 'written directly' })
  check('a team cannot be inserted directly', refused(inserted), inserted?.code ?? 'accepted')

  const { error: updated } = await supabase.from('teams').update({ name: 'renamed' }).eq('id', id)
  check('nor updated directly', refused(updated), updated?.code ?? 'accepted')

  const { error: removed } = await supabase.from('teams').delete().eq('id', id)
  check('nor deleted directly', refused(removed), removed?.code ?? 'accepted')
  check('and it is still there, still named as it was',
    (await rowOf(id))?.name === `${NAME} direct`)

  const { error: joined } = await supabase
    .from('team_members')
    .insert({ team_id: id, member_id: myMembership })
  check('a roster cannot be written directly', refused(joined), joined?.code ?? 'accepted')

  const { error: left } = await supabase.from('team_members').delete().eq('team_id', id)
  check('nor emptied directly', refused(left), left?.code ?? 'accepted')
}

console.log('\n8 · the record')
{
  const { data } = await supabase
    .from('audit_logs')
    .select('action, entity_type, actor_id, metadata')
    .eq('organization_id', orgId)
    .eq('entity_type', 'team')
    .order('created_at', { ascending: false })
    .limit(60)

  const actions = new Set((data ?? []).map((row) => row.action))
  for (const action of [
    'team.created',
    'team.updated',
    'team.archived',
    'team.restored',
    'team.member_added',
    'team.member_removed',
    'team.roster_updated',
    'team.member_moved',
  ]) {
    check(`${action} is recorded`, actions.has(action))
  }
  check(
    'and the actor is whoever was signed in',
    (data ?? []).length > 0 && (data ?? []).every((row) => row.actor_id === me),
  )
  // A roster entry says which membership changed, not who the person is.
  const added = (data ?? []).find((row) => row.action === 'team.member_added')
  check('a roster entry carries no personal detail',
    added !== undefined && !JSON.stringify(added.metadata).includes('@'),
    JSON.stringify(added?.metadata ?? {}))
}

console.log('\n9 · clearing up')
{
  // Teams have no delete routine by design, so the probes are archived and
  // then removed through the operator path, which is what the note below says.
  const { data: mine } = await supabase.from('teams').select('id, archived_at').like('name', `${NAME}%`)
  for (const row of mine ?? []) {
    if (row.archived_at === null) await supabase.rpc('archive_team', { p_team_id: row.id })
  }
  const { data: left } = await supabase
    .from('teams')
    .select('id, archived_at')
    .like('name', `${NAME}%`)
  const active = (left ?? []).filter((row) => row.archived_at === null)
  check('every probe team is archived', active.length === 0, `${String(active.length)} active`)

  console.log(
    `\n        ${String((left ?? []).length)} probe team(s) remain, archived. 7.1 has no\n` +
      '        delete routine on purpose — teams are what rosters and results will\n' +
      '        hang off — so clearing them is an operator job:\n\n' +
      "          delete from public.teams where name like 'Team probe%';\n",
  )
}

await supabase.auth.signOut({ scope: 'local' })

console.log(
  failures === 0 ? 'All team checks passed.\n' : `${String(failures)} check(s) failed.\n`,
)
console.log(
  'Two things this environment cannot show. A member who lacks teams.manage or\n' +
    'teams.roster_manage being refused is not exercised: the only credential here\n' +
    'is the owner, who implicitly holds everything, and has_org_permission is what\n' +
    'every routine asks. And a team in one organization taking a member from\n' +
    'another cannot be attempted from any client, because bootstrap_organization\n' +
    'is deliberately granted to nobody — that pairing is refused by a trigger, and\n' +
    'proving it needs the operator path rather than this script.\n',
)
process.exit(failures === 0 ? 0 : 1)
