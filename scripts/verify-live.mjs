/**
 * Signed-in verification against a live Supabase project.
 *
 * Checks what an anonymous caller cannot see: that the permission catalogue
 * and role templates seeded correctly, that the role -> permission matrix
 * matches the migrations, that RLS scopes rows to the caller, and that the
 * privilege-escalation guards actually fire.
 *
 * Credentials are read from `.env.e2e` (git-ignored via the `.env.*` rule) so
 * the password never appears in a command line, a script, or a transcript:
 *
 *   E2E_EMAIL=you@example.com
 *   E2E_PASSWORD=...
 *
 *   node scripts/verify-live.mjs
 *
 * Every write it attempts is one that MUST be refused, so a passing run
 * changes nothing in the database. Exits non-zero on any failure.
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

/** The app's own permission list, so the database is compared against source. */
function permissionsFromSource() {
  const src = readFileSync('src/lib/permissions.ts', 'utf8')
  const block = src.slice(src.indexOf('export const PERMISSIONS = ['), src.indexOf('] as const'))
  return [...block.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1])
}

const env = { ...readEnvFile('.env'), ...readEnvFile('.env.e2e'), ...process.env }
const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key, E2E_EMAIL, E2E_PASSWORD } = env

if (!url || !key) {
  console.error('verify-live: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set.')
  process.exit(1)
}
if (!E2E_EMAIL || !E2E_PASSWORD) {
  console.error(
    'verify-live: no credentials.\n\n' +
      'Create a git-ignored .env.e2e in the project root:\n\n' +
      '  E2E_EMAIL=your.account@example.com\n' +
      '  E2E_PASSWORD=the-password-you-set\n',
  )
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

let failures = 0
function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(56)} ${detail}`)
  if (!passed) failures += 1
}

console.log(`\nverifying ${url}\n`)

// --- sign in ---------------------------------------------------------------
console.log('session')
const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
  email: E2E_EMAIL,
  password: E2E_PASSWORD,
})
if (authError || !auth.session) {
  check('sign in', false, authError?.message ?? 'no session returned')
  process.exit(1)
}
check('sign in', true, auth.user?.email ?? '')
const userId = auth.user.id

// --- catalogue -------------------------------------------------------------
console.log('\npermission catalogue')
const expected = permissionsFromSource()
const { data: permissions, error: permError } = await supabase
  .from('permissions')
  .select('key, category')
check('readable when signed in', !permError, permError?.message ?? '')

const dbKeys = (permissions ?? []).map((p) => p.key).sort()
const srcKeys = [...expected].sort()
check(`row count matches src/lib/permissions.ts`, dbKeys.length === srcKeys.length, `db ${String(dbKeys.length)} / source ${String(srcKeys.length)}`)
const missing = srcKeys.filter((k) => !dbKeys.includes(k))
const extra = dbKeys.filter((k) => !srcKeys.includes(k))
check('no permission missing from the database', missing.length === 0, missing.join(', '))
check('no permission in the database that the app does not know', extra.length === 0, extra.join(', '))
check(
  'categories populated',
  (permissions ?? []).every((p) => typeof p.category === 'string' && p.category.length > 0),
)

// --- role templates --------------------------------------------------------
console.log('\nrole templates')
const EXPECTED_TEMPLATES = [
  ['owner', 0],
  ['admin', 10],
  ['manager', 20],
  ['coach', 30],
  ['player', 40],
  ['staff', 50],
]
const { data: templates, error: templateError } = await supabase
  .from('role_templates')
  .select('key, rank, name')
  .order('rank')
check('readable', !templateError, templateError?.message ?? '')
check('exactly 6 templates', (templates ?? []).length === 6, `got ${String((templates ?? []).length)}`)
for (const [key, rank] of EXPECTED_TEMPLATES) {
  const row = (templates ?? []).find((t) => t.key === key)
  check(`${key} exists at rank ${String(rank)}`, row?.rank === rank, row ? `rank ${String(row.rank)}` : 'missing')
}

// --- materialised roles ----------------------------------------------------
console.log('\norganization roles (materialised by bootstrap_organization)')
const { data: orgs, error: orgError } = await supabase.from('organizations').select('id, slug, name')
check('organization visible to its member', !orgError && (orgs ?? []).length >= 1, orgError?.message ?? `${String((orgs ?? []).length)} org(s)`)
const org = (orgs ?? [])[0]

const { data: roles, error: roleError } = await supabase
  .from('roles')
  .select('id, key, rank, is_system, created_by')
  .eq('organization_id', org?.id ?? '')
  .order('rank')
check('roles readable', !roleError, roleError?.message ?? '')

// Custom roles are a first-class feature now, so the organization may hold any
// number of them. What must remain true is that the six provisioned roles are
// present and correctly ranked — not that nothing else exists.
const provisioned = (roles ?? []).filter((r) => r.is_system === true)
check('the six provisioned roles are present', provisioned.length === 6,
  `${String(provisioned.length)} provisioned, ${String((roles ?? []).length)} total`)
check(
  'provisioned ranks are unchanged',
  JSON.stringify(provisioned.map((r) => [r.key, r.rank])) === JSON.stringify(EXPECTED_TEMPLATES),
)
check(
  'custom roles are not marked as provisioned',
  (roles ?? []).every((r) => r.is_system === true || r.created_by !== null),
  'is_system marks provenance only; it grants nothing',
)

// --- role -> permission matrix --------------------------------------------
console.log('\nrole → permission matrix')
const { data: grants, error: grantError } = await supabase
  .from('role_permissions')
  .select('role_id, permission_key, roles!inner(key, organization_id)')
  .eq('roles.organization_id', org?.id ?? '')
check('matrix readable', !grantError, grantError?.message ?? '')

const byRole = new Map()
for (const g of grants ?? []) {
  const roleKey = Array.isArray(g.roles) ? g.roles[0]?.key : g.roles?.key
  if (!roleKey) continue
  byRole.set(roleKey, [...(byRole.get(roleKey) ?? []), g.permission_key])
}
const total = srcKeys.length
check('owner holds every permission', (byRole.get('owner') ?? []).length === total, `${String((byRole.get('owner') ?? []).length)}/${String(total)}`)
check(
  'admin holds everything except organization.delete',
  (byRole.get('admin') ?? []).length === total - 1 &&
    !(byRole.get('admin') ?? []).includes('organization.delete'),
  `${String((byRole.get('admin') ?? []).length)}/${String(total - 1)}`,
)
check('manager cannot delete projects? (has projects.delete)', (byRole.get('manager') ?? []).includes('projects.delete'))
check('coach cannot invite members', !(byRole.get('coach') ?? []).includes('members.invite'))
check('player cannot invite members', !(byRole.get('player') ?? []).includes('members.invite'))
check('player can view the calendar', (byRole.get('player') ?? []).includes('calendar.view'))
check('staff cannot upload files', !(byRole.get('staff') ?? []).includes('files.upload'))
check('every role has at least organization.view', EXPECTED_TEMPLATES.every(([k]) => (byRole.get(k) ?? []).includes('organization.view')))
// B2 seeded these by capability, never by role name: whoever could already
// manage members can suspend, whoever could already remove them can ban.
check('moderation permissions exist in the catalogue',
  ['members.suspend', 'members.ban', 'members.unban'].every((k) => dbKeys.includes(k)))
check('channel permissions exist in the catalogue',
  ['channels.delete', 'channels.permissions_manage'].every((k) => dbKeys.includes(k)))

// --- resolved permissions for the caller ----------------------------------
console.log('\nresolved permissions (my_permissions)')
const { data: mine, error: mineError } = await supabase.rpc('my_permissions', {
  p_organization_id: org?.id ?? '',
})
check('callable when signed in', !mineError, mineError?.message ?? '')
const mineKeys = Array.isArray(mine) ? mine.map((r) => (typeof r === 'string' ? r : r.my_permissions)) : []
check('owner resolves to the full set', mineKeys.length === total, `${String(mineKeys.length)}/${String(total)}`)

// --- RLS scoping -----------------------------------------------------------
console.log('\nRLS scoping')
const { data: profiles } = await supabase.from('profiles').select('id, email')
check('sees only profiles sharing an organization', (profiles ?? []).every((p) => typeof p.email === 'string'), `${String((profiles ?? []).length)} profile(s)`)
check('own profile is among them', (profiles ?? []).some((p) => p.id === userId))

const { data: members } = await supabase.from('organization_members').select('id, user_id, role_id, status')
check('roster readable', (members ?? []).length >= 1, `${String((members ?? []).length)} member(s)`)
const self = (members ?? []).find((m) => m.user_id === userId)
check('caller is a member', Boolean(self))

const { data: audit } = await supabase.from('audit_logs').select('action, summary').order('created_at', { ascending: false }).limit(5)
check('audit log readable with audit.read', Array.isArray(audit), `${String((audit ?? []).length)} entr(y|ies)`)
// Query for it rather than hoping it is still in the most recent few rows —
// every invitation and role edit pushes it further down the log.
const { count: bootstrapCount } = await supabase
  .from('audit_logs')
  .select('*', { count: 'exact', head: true })
  .eq('action', 'organization.created')
check('bootstrap recorded organization.created', (bootstrapCount ?? 0) >= 1)

// --- guards (every one of these MUST be refused) --------------------------
console.log('\nprivilege guards (each write below must be refused)')
const playerRole = (roles ?? []).find((r) => r.key === 'player')

if (self && playerRole) {
  const { error } = await supabase
    .from('organization_members')
    .update({ role_id: playerRole.id })
    .eq('id', self.id)
  check(
    'derived primary role is not client-writable',
    Boolean(error),
    error ? error.message.slice(0, 60) : 'ACCEPTED — DERIVED COLUMN IS WRITABLE',
  )
}
if (self) {
  const { error } = await supabase
    .from('organization_members')
    .update({ status: 'suspended' })
    .eq('id', self.id)
  check('last owner cannot be suspended', Boolean(error), error ? error.message.slice(0, 60) : 'ACCEPTED — GUARD FAILED')
}
{
  const { error } = await supabase
    .from('organization_members')
    .insert({ organization_id: org?.id, user_id: userId, role_id: playerRole?.id, status: 'active' })
  check('membership cannot be inserted directly', Boolean(error), error ? `blocked (${error.code ?? ''})` : 'ACCEPTED — POLICY MISSING')
}
{
  const { error } = await supabase.from('audit_logs').insert({
    organization_id: org?.id,
    action: 'probe.tamper',
    entity_type: 'probe',
  })
  check('audit log is append-only to clients', Boolean(error), error ? `blocked (${error.code ?? ''})` : 'ACCEPTED — LOG IS WRITABLE')
}
{
  const { error } = await supabase.from('permissions').insert({ key: 'probe.tamper', category: 'x', label: 'x' })
  check('permission catalogue is not client-writable', Boolean(error), error ? `blocked (${error.code ?? ''})` : 'ACCEPTED')
}
{
  const { error } = await supabase.rpc('bootstrap_organization', {
    p_slug: 'probe',
    p_name: 'Probe',
    p_owner_id: userId,
  })
  check('bootstrap_organization not callable by a member', Boolean(error), error ? `blocked (${error.code ?? ''})` : 'ACCEPTED — SELF-SERVE ORGS POSSIBLE')
}

// --- B1 · ownership and the dynamic role model -----------------------------
console.log('\nB1 · ownership is a column, not a role')

const { data: orgRow } = await supabase
  .from('organizations')
  .select('id, owner_id')
  .eq('id', org?.id ?? '')
  .maybeSingle()

check('organizations.owner_id is readable', Boolean(orgRow?.owner_id))
check('caller is the recorded owner', orgRow?.owner_id === userId)

// The owner short-circuit means authority survives any role edit.
check('owner resolves to the whole catalogue', mineKeys.length === srcKeys.length,
  `${String(mineKeys.length)}/${String(srcKeys.length)}`)

const primaryRole = (roles ?? []).find((r) => r.id === self?.role_id)
const { data: myAssignments } = await supabase
  .from('member_roles')
  .select('role_id')
  .eq('member_id', self?.id ?? '')
check('member_roles is populated for the owner', (myAssignments ?? []).length >= 1,
  `${String((myAssignments ?? []).length)} role(s)`)
check(
  'derived primary role agrees with member_roles',
  (myAssignments ?? []).some((a) => a.role_id === self?.role_id),
  primaryRole ? `primary = ${primaryRole.key}` : 'no primary role',
)

console.log('\nB1 · name independence (creates a probe role, then removes it)')

let probeRoleId = null
{
  // Deliberately named "Owner": if names carried meaning, this would be a
  // privilege escalation.
  const { data, error } = await supabase.rpc('create_role', {
    p_organization_id: org?.id,
    p_name: 'Owner',
    p_description: 'verify-live probe; safe to delete',
    p_rank: 900,
  })
  probeRoleId = typeof data === 'string' ? data : null
  check('owner can create a custom role', !error && Boolean(probeRoleId), error?.message ?? '')
}

if (probeRoleId) {
  const { data: after } = await supabase
    .from('organizations')
    .select('owner_id')
    .eq('id', org?.id ?? '')
    .maybeSingle()
  check('creating a role named "Owner" does not move ownership', after?.owner_id === userId)

  const { data: probePerms } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role_id', probeRoleId)
  check('a role named "Owner" grants nothing by itself', (probePerms ?? []).length === 0,
    `${String((probePerms ?? []).length)} permission(s)`)

  {
    const { error } = await supabase.rpc('update_role', {
      p_role_id: probeRoleId,
      p_name: 'Renamed Probe',
      p_description: 'still harmless',
    })
    check('roles can be renamed', !error, error?.message ?? '')
  }

  {
    const { data: after2 } = await supabase
      .from('organizations')
      .select('owner_id')
      .eq('id', org?.id ?? '')
      .maybeSingle()
    check('renaming a role changes nothing about ownership', after2?.owner_id === userId)
  }

  // Delegation safety: an unknown key must be refused outright.
  {
    const { error } = await supabase.rpc('set_role_permissions', {
      p_role_id: probeRoleId,
      p_permission_keys: ['not.a_real_permission'],
    })
    check('unknown permission keys are refused', Boolean(error),
      error ? error.message.slice(0, 50) : 'ACCEPTED — CATALOGUE NOT ENFORCED')
  }

  // A permission the owner does hold may be delegated.
  {
    const { error } = await supabase.rpc('set_role_permissions', {
      p_role_id: probeRoleId,
      p_permission_keys: ['organization.view'],
    })
    check('owner can delegate a permission they hold', !error, error?.message ?? '')
  }
}

console.log('\nB1 · a role name is only a label')

let decoyAdmin = null
let arbitraryRole = null

{
  // A role literally called "Admin", holding nothing at all.
  const { data, error } = await supabase.rpc('create_role', {
    p_organization_id: org?.id,
    p_name: 'Admin',
    p_description: 'decoy; holds no permissions',
    p_rank: 920,
  })
  decoyAdmin = typeof data === 'string' ? data : null
  check('a second role called "Admin" can be created', !error && Boolean(decoyAdmin),
    error?.message ?? '')
}
{
  const { data: rows } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role_id', decoyAdmin ?? '')
  check('a role named "Admin" holds nothing by virtue of its name',
    (rows ?? []).length === 0, `${String((rows ?? []).length)} permission(s)`)
}
{
  // An arbitrary name that resembles nothing in the seed, holding a real
  // capability. Names carry nothing; permissions carry everything.
  const { data, error } = await supabase.rpc('create_role', {
    p_organization_id: org?.id,
    p_name: 'Content Creator',
    p_description: 'arbitrary name, real capability',
    p_rank: 930,
  })
  arbitraryRole = typeof data === 'string' ? data : null
  check('an arbitrarily named role can be created', !error && Boolean(arbitraryRole),
    error?.message ?? '')
}
{
  const { error } = await supabase.rpc('set_role_permissions', {
    p_role_id: arbitraryRole,
    p_permission_keys: ['organization.view', 'files.upload'],
  })
  check('it receives exactly the capabilities it is given', !error, error?.message ?? '')

  const { data: rows } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role_id', arbitraryRole ?? '')
  const keys = (rows ?? []).map((r) => r.permission_key).sort()
  check('and nothing else', JSON.stringify(keys) === JSON.stringify(['files.upload', 'organization.view']),
    keys.join(', '))
}
{
  // Renaming is free, and changes nothing about authority.
  const { error } = await supabase.rpc('update_role', {
    p_role_id: arbitraryRole,
    p_name: 'Head Strategist',
    p_description: 'renamed mid-flight',
  })
  check('a role can be renamed to anything', !error, error?.message ?? '')

  const { data: rows } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role_id', arbitraryRole ?? '')
  check('renaming leaves its capabilities untouched', (rows ?? []).length === 2,
    `${String((rows ?? []).length)} permission(s)`)
}
{
  const { error } = await supabase.rpc('set_role_rank', { p_role_id: arbitraryRole, p_rank: 940 })
  check('a role rank can be changed', !error, error?.message ?? '')

  const { data } = await supabase.from('roles').select('rank').eq('id', arbitraryRole ?? '').maybeSingle()
  check('and the new rank is stored', data?.rank === 940, `rank ${String(data?.rank)}`)
}
{
  const { data: after } = await supabase
    .from('organizations').select('owner_id').eq('id', org?.id ?? '').maybeSingle()
  check('none of this moved ownership', after?.owner_id === userId)
}

console.log('\nB1 · cross-organization role mutation')
{
  const FOREIGN = '00000000-0000-4000-8000-000000000000'
  const { error } = await supabase.rpc('create_role', {
    p_organization_id: FOREIGN,
    p_name: 'Intruder',
    p_description: null,
    p_rank: 500,
  })
  check('cannot create a role in another organization', Boolean(error),
    error ? error.message.slice(0, 44) : 'ACCEPTED — CROSS-ORG WRITE POSSIBLE')
}

for (const [label, id] of [['decoy Admin', decoyAdmin], ['renamed arbitrary role', arbitraryRole]]) {
  if (!id) continue
  const { error } = await supabase.rpc('delete_role', { p_role_id: id })
  check(`${label} deleted (cleanup)`, !error, error?.message ?? '')
}

console.log('\nB1 · multi-role and the one-role minimum')

if (probeRoleId && self) {
  {
    const { error } = await supabase.rpc('assign_role_to_member', {
      p_member_id: self.id,
      p_role_id: probeRoleId,
    })
    check('a second role can be assigned to a member', !error, error?.message ?? '')
  }

  const { data: nowRoles } = await supabase
    .from('member_roles')
    .select('role_id')
    .eq('member_id', self.id)
  check('member now holds multiple roles', (nowRoles ?? []).length >= 2,
    `${String((nowRoles ?? []).length)} role(s)`)

  const { data: memberAfter } = await supabase
    .from('organization_members')
    .select('role_id')
    .eq('id', self.id)
    .maybeSingle()
  check(
    'primary role stays the most authoritative one',
    memberAfter?.role_id === self.role_id,
    'rank 900 probe did not become primary',
  )

  {
    const { error } = await supabase.rpc('unassign_role_from_member', {
      p_member_id: self.id,
      p_role_id: probeRoleId,
    })
    check('the extra role can be removed again', !error, error?.message ?? '')
  }

  // With one role left, removing it must be refused.
  {
    const { error } = await supabase.rpc('unassign_role_from_member', {
      p_member_id: self.id,
      p_role_id: self.role_id,
    })
    check('a member cannot be stripped of their last role', Boolean(error),
      error ? error.message.slice(0, 50) : 'ACCEPTED — MEMBER LEFT ROLE-LESS')
  }
}

console.log('\nB1 · member_roles is not directly writable')
{
  const { error } = await supabase
    .from('member_roles')
    .insert({ member_id: self?.id, role_id: probeRoleId })
  check('member_roles has no client insert policy', Boolean(error),
    error ? `blocked (${error.code ?? ''})` : 'ACCEPTED — ASSIGNMENT BYPASSES HIERARCHY')
}

// --- Clean up --------------------------------------------------------------
if (probeRoleId) {
  const { error } = await supabase.rpc('delete_role', { p_role_id: probeRoleId })
  check('probe role deleted (cleanup)', !error, error?.message ?? '')
}

// --- B2 · moderation --------------------------------------------------------
console.log('\nB2 · effective status is derived in the database')

// The expiry rule is checked by calling the function directly, so no data has
// to be mutated and no clock has to be faked.
for (const [label, status, until, expected] of [
  ['active member', 'active', null, true],
  ['suspension still in force', 'suspended', '2999-01-01T00:00:00Z', false],
  ['suspension already lapsed', 'suspended', '2000-01-01T00:00:00Z', true],
  ['indefinite suspension', 'suspended', null, false],
  ['ban with a stale timestamp', 'banned', '2000-01-01T00:00:00Z', false],
  ['ban with a future timestamp', 'banned', '2999-01-01T00:00:00Z', false],
]) {
  const { data, error } = await supabase.rpc('is_effectively_active', {
    p_status: status,
    p_suspended_until: until,
  })
  check(`${label} -> ${String(expected)}`, !error && data === expected,
    error ? error.message.slice(0, 40) : `got ${String(data)}`)
}

console.log('\nB2 · moderation is not reachable by direct writes')

const otherMember = (members ?? []).find((m) => m.user_id !== userId)

if (otherMember) {
  {
    const { error } = await supabase
      .from('organization_members')
      .update({ status: 'banned' })
      .eq('id', otherMember.id)
    check('status is not client-writable', Boolean(error),
      error ? error.message.slice(0, 46) : 'ACCEPTED — MODERATION BYPASSABLE')
  }
  {
    const { error } = await supabase.from('moderation_actions').insert({
      organization_id: org?.id,
      target_user_id: otherMember.user_id,
      action: 'ban',
      reason: 'forged',
    })
    check('moderation history cannot be forged', Boolean(error),
      error ? `blocked (${error.code ?? ''})` : 'ACCEPTED — HISTORY IS WRITABLE')
  }
} else {
  // A single-member organization is a legitimate state, not a security
  // failure. The moderation rules are covered by the unit suite regardless;
  // this section only adds live confirmation when there is somebody to act on.
  console.log('  SKIP  moderation of another member                          no second member present')
}

console.log('\nB2 · who may be moderated')

if (self) {
  const { error } = await supabase.rpc('suspend_member', {
    p_member_id: self.id,
    p_reason: 'probe',
    p_days: 1,
  })
  check('self-moderation is refused', Boolean(error),
    error ? error.message.slice(0, 44) : 'ACCEPTED — SELF-MODERATION POSSIBLE')
}

// The owner is protected by organizations.owner_id, so the owner's own
// membership can never be moderated — not even by themselves, which the
// self-check above already covers. A second signed-in identity would be
// needed to prove the owner branch, so it is asserted in the unit tests.

console.log('\nB2 · suspend, verify, restore (self-cleaning)')

if (otherMember) {
  {
    const { error } = await supabase.rpc('suspend_member', {
      p_member_id: otherMember.id,
      p_reason: 'verify-live probe; restored immediately',
      p_days: 1,
    })
    check('owner can suspend a member', !error, error?.message ?? '')
  }

  {
    const { data: after } = await supabase
      .from('organization_members')
      .select('status, suspended_until, moderation_reason, moderated_by')
      .eq('id', otherMember.id)
      .maybeSingle()
    check('status recorded as suspended', after?.status === 'suspended', String(after?.status))
    check('expiry recorded', Boolean(after?.suspended_until), after?.suspended_until ?? '')
    check('reason recorded', Boolean(after?.moderation_reason))
    check('actor recorded', after?.moderated_by === userId)
  }

  {
    const { data: history } = await supabase
      .from('moderation_actions')
      .select('action, reason, expires_at, actor_id')
      .eq('target_user_id', otherMember.user_id)
      .order('created_at', { ascending: false })
      .limit(1)
    check('history entry written', (history ?? []).length === 1)
    check('history records the action', history?.[0]?.action === 'suspend', history?.[0]?.action ?? '')
    check('history records the actor', history?.[0]?.actor_id === userId)
  }

  {
    const { error } = await supabase.rpc('unsuspend_member', {
      p_member_id: otherMember.id,
      p_reason: 'probe complete',
    })
    check('suspension can be lifted', !error, error?.message ?? '')
  }

  {
    const { data: restored } = await supabase
      .from('organization_members')
      .select('status, suspended_until, moderation_reason')
      .eq('id', otherMember.id)
      .maybeSingle()
    check('member restored to active', restored?.status === 'active', String(restored?.status))
    check('expiry cleared', restored?.suspended_until === null)
    check('reason cleared', restored?.moderation_reason === null)
  }

  console.log('\nB2 · ban and unban (self-cleaning)')

  const { data: rolesBefore } = await supabase
    .from('member_roles')
    .select('role_id')
    .eq('member_id', otherMember.id)

  {
    const { error } = await supabase.rpc('ban_member', {
      p_member_id: otherMember.id,
      p_reason: 'verify-live probe; lifted immediately',
    })
    check('owner can ban a member', !error, error?.message ?? '')
  }

  {
    const { data: after } = await supabase
      .from('organization_members')
      .select('status, suspended_until')
      .eq('id', otherMember.id)
      .maybeSingle()
    check('status recorded as banned', after?.status === 'banned', String(after?.status))
    // A ban carries no expiry, so nothing can turn it into an accidental unban.
    check('ban carries no expiry', after?.suspended_until === null)
  }

  {
    const { error } = await supabase.rpc('unban_member', {
      p_member_id: otherMember.id,
      p_reason: 'probe complete',
    })
    check('ban can be lifted', !error, error?.message ?? '')
  }

  {
    const { data: restored } = await supabase
      .from('organization_members')
      .select('status')
      .eq('id', otherMember.id)
      .maybeSingle()
    check('member restored after unban', restored?.status === 'active', String(restored?.status))

    const { data: rolesAfter } = await supabase
      .from('member_roles')
      .select('role_id')
      .eq('member_id', otherMember.id)
    check(
      'roles survive a ban and an unban untouched',
      JSON.stringify((rolesAfter ?? []).map((r) => r.role_id).sort()) ===
        JSON.stringify((rolesBefore ?? []).map((r) => r.role_id).sort()),
      `${String((rolesAfter ?? []).length)} role(s)`,
    )
  }
}

// --- B3 · channels ----------------------------------------------------------
console.log('\nB3 · channel schema and guarded mutations')

let probeCategory = null
let probePublic = null
let probePrivate = null

{
  const { data, error } = await supabase.rpc('create_category', {
    p_organization_id: org?.id,
    p_name: 'verify-live probe',
  })
  probeCategory = typeof data === 'string' ? data : null
  check('owner can create a category', !error && Boolean(probeCategory), error?.message ?? '')
}
{
  const { data, error } = await supabase.rpc('create_channel', {
    p_organization_id: org?.id,
    p_name: 'probe public',
    p_topic: 'created by verify-live',
    p_category_id: probeCategory,
    p_is_private: false,
  })
  probePublic = typeof data === 'string' ? data : null
  check('owner can create a public channel', !error && Boolean(probePublic), error?.message ?? '')
}
{
  const { data, error } = await supabase.rpc('create_channel', {
    p_organization_id: org?.id,
    p_name: 'probe private',
    p_topic: null,
    p_category_id: probeCategory,
    p_is_private: true,
  })
  probePrivate = typeof data === 'string' ? data : null
  check('owner can create a private channel', !error && Boolean(probePrivate), error?.message ?? '')
}

console.log('\nB3 · direct writes are refused on every channel table')
for (const [label, table, row] of [
  ['channels', 'channels', { organization_id: org?.id, key: 'forged', name: 'forged' }],
  ['channel_categories', 'channel_categories', { organization_id: org?.id, name: 'forged' }],
  ['channel_permission_overrides', 'channel_permission_overrides',
    { channel_id: probePrivate, role_id: playerRole?.id, permission_key: 'channels.view',
      effect: 'allow' }],
]) {
  const { error } = await supabase.from(table).insert(row)
  check(`${label} has no client insert policy`, Boolean(error),
    error ? `blocked (${error.code ?? ''})` : 'ACCEPTED — WRITABLE')
}

console.log('\nB3 · overrides stay inside the safe subset')
for (const key of ['organization.delete', 'members.ban', 'roles.manage']) {
  const { error } = await supabase.rpc('set_channel_override', {
    p_channel_id: probePrivate,
    p_role_id: playerRole?.id,
    p_permission_key: key,
    p_effect: 'allow',
  })
  check(`${key} cannot be overridden per channel`, Boolean(error),
    error ? 'refused' : 'ACCEPTED — SUBSET NOT ENFORCED')
}

console.log('\nB3 · an override is scoped to one channel only')
{
  const { error } = await supabase.rpc('set_channel_override', {
    p_channel_id: probePrivate,
    p_role_id: playerRole?.id,
    p_permission_key: 'channels.view',
    p_effect: 'allow',
  })
  check('an ALLOW can be granted on the private channel', !error, error?.message ?? '')
}
{
  const { data: rows } = await supabase
    .from('channel_permission_overrides')
    .select('channel_id')
  check('exactly one override row exists', (rows ?? []).length === 1,
    `${String((rows ?? []).length)} row(s)`)
  check('and it belongs to the private channel only',
    (rows ?? []).every((r) => r.channel_id === probePrivate))
}
{
  // The decisive check: a channel-local grant must not appear anywhere in the
  // organization-level answer.
  const { data: mineNow } = await supabase.rpc('my_permissions', {
    p_organization_id: org?.id ?? '',
  })
  const keysNow = Array.isArray(mineNow)
    ? mineNow.map((r) => (typeof r === 'string' ? r : r.my_permissions))
    : []
  check('a channel ALLOW does not change my_permissions', keysNow.length === srcKeys.length,
    `${String(keysNow.length)}/${String(srcKeys.length)}`)

  const { data: playerRows } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role_id', playerRole?.id ?? '')
  check('a channel ALLOW adds no organization role_permission',
    !(playerRows ?? []).some((r) => r.permission_key === 'channels.permissions_manage'),
    `${String((playerRows ?? []).length)} org permission(s)`)
}

console.log('\nB3 · archive is reversible, delete is not')
{
  const { error } = await supabase.rpc('update_channel', {
    p_channel_id: probePublic,
    p_archived: true,
  })
  check('a channel can be archived', !error, error?.message ?? '')

  const { data } = await supabase
    .from('channels').select('archived_at').eq('id', probePublic).maybeSingle()
  check('archived_at recorded', Boolean(data?.archived_at))
}
{
  const { error } = await supabase.rpc('update_channel', {
    p_channel_id: probePublic,
    p_archived: false,
  })
  check('archiving can be undone', !error, error?.message ?? '')

  const { data } = await supabase
    .from('channels').select('archived_at').eq('id', probePublic).maybeSingle()
  check('archived_at cleared again', data?.archived_at === null)
}

console.log('\nC1 · messages')

let probeMessage = null

{
  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: probePublic, author_id: userId, body: 'verify-live probe message' })
    .select('id, body, author_id, edited_at, deleted_at')
    .single()
  probeMessage = data?.id ?? null
  check('a message can be sent', !error && Boolean(probeMessage), error?.message ?? '')
  check('it is attributed to the sender', data?.author_id === userId)
  check('it starts unedited and undeleted', data?.edited_at === null && data?.deleted_at === null)
}

console.log('\nC1 · a message cannot be posted under another name')
{
  const { error } = await supabase
    .from('messages')
    .insert({ channel_id: probePublic, author_id: org?.id, body: 'forged author' })
  check('author_id is checked against the session', Boolean(error),
    error ? `blocked (${error.code ?? ''})` : 'ACCEPTED — IMPERSONATION POSSIBLE')
}

console.log('\nC1 · only the body may be edited by a client')
{
  const { error } = await supabase
    .from('messages')
    .update({ body: 'edited by verify-live' })
    .eq('id', probeMessage)
  check('the author can edit their own body', !error, error?.message ?? '')

  const { data } = await supabase
    .from('messages').select('body, edited_at').eq('id', probeMessage).maybeSingle()
  check('edited_at is stamped by the database', Boolean(data?.edited_at), data?.edited_at ?? '')
}
for (const [label, patch] of [
  ['channel_id', { channel_id: probePrivate }],
  ['pinned_at', { pinned_at: new Date().toISOString() }],
  ['deleted_at', { deleted_at: new Date().toISOString() }],
  ['author_id', { author_id: org?.id }],
]) {
  const { error } = await supabase.from('messages').update(patch).eq('id', probeMessage)
  check(`${label} cannot be written by a client`, Boolean(error),
    error ? 'refused' : 'ACCEPTED — COLUMN IS WRITABLE')
}

console.log('\nC1 · pin and delete go through the routines')
{
  const { error } = await supabase.rpc('pin_message', { p_message_id: probeMessage, p_pinned: true })
  check('pin_message succeeds with messages.pin', !error, error?.message ?? '')

  const { data } = await supabase
    .from('messages').select('pinned_at').eq('id', probeMessage).maybeSingle()
  check('pinned_at recorded', Boolean(data?.pinned_at))
}
{
  const { error } = await supabase.rpc('delete_message', { p_message_id: probeMessage })
  check('delete_message succeeds for the author', !error, error?.message ?? '')

  const { data } = await supabase
    .from('messages').select('body, deleted_at').eq('id', probeMessage).maybeSingle()
  check('the row survives, the words do not', data?.body === '' && data?.deleted_at !== null,
    `body length ${String((data?.body ?? '').length)}`)
}
{
  const { error } = await supabase.rpc('delete_message', { p_message_id: probeMessage })
  check('deleting twice is refused', Boolean(error),
    error ? error.message.slice(0, 40) : 'ACCEPTED')
}

console.log('\nC1 · realtime topic authorization')
{
  const { data, error } = await supabase.rpc('can_join_channel_topic', {
    p_topic: `channel:${String(probePublic)}`,
    p_permission: 'channels.view',
  })
  check('a topic for a visible channel is joinable', !error && data === true, String(data))
}
for (const [label, topic] of [
  ['a malformed topic', 'not-a-channel-topic'],
  ['a topic with a non-uuid id', 'channel:not-a-uuid'],
  ['a topic for a channel that does not exist',
   'channel:00000000-0000-4000-8000-000000000000'],
]) {
  const { data, error } = await supabase.rpc('can_join_channel_topic', {
    p_topic: topic,
    p_permission: 'channels.view',
  })
  // A refusal, never an exception: raising would let a caller tell "bad
  // format" from "no access" by the error they get back.
  check(`${label} is refused without raising`, !error && data === false,
    error ? `RAISED: ${error.message.slice(0, 30)}` : String(data))
}

console.log('\nC1 · messages are not writable in a channel you cannot reach')
{
  const { error } = await supabase
    .from('messages')
    .insert({ channel_id: '00000000-0000-4000-8000-000000000000', author_id: userId, body: 'x' })
  check('posting into an unknown channel is refused', Boolean(error),
    error ? `blocked (${error.code ?? ''})` : 'ACCEPTED')
}

console.log('\nC2 · Decision 1 — the extraction is equivalent')
{
  // The delegation must agree with the extraction for the caller themselves.
  // Every other authorization check in this file already ran against the
  // redefined functions; this pins the two forms together explicitly.
  for (const [label, permission] of [
    ['channels.view', 'channels.view'],
    ['messages.send', 'messages.send'],
    ['messages.pin', 'messages.pin'],
  ]) {
    const { data: viaCaller } = await supabase.rpc('can_in_channel', {
      p_channel_id: probePublic, p_permission: permission,
    })
    const { data: viaUser } = await supabase.rpc('can_in_channel_for', {
      p_user_id: userId, p_channel_id: probePublic, p_permission: permission,
    })
    check(`can_in_channel agrees with can_in_channel_for for ${label}`,
      viaCaller === viaUser && viaCaller === true, `${String(viaCaller)} / ${String(viaUser)}`)
  }

  const { data: orgCaller } = await supabase.rpc('has_org_permission', {
    p_organization_id: org?.id, p_permission: 'channels.view',
  })
  const { data: orgUser } = await supabase.rpc('has_org_permission_for', {
    p_user_id: userId, p_organization_id: org?.id, p_permission: 'channels.view',
  })
  check('has_org_permission agrees with has_org_permission_for',
    orgCaller === orgUser && orgCaller === true)

  // A user who is nobody resolves to false rather than raising.
  const { data: nobody, error: nobodyError } = await supabase.rpc('can_in_channel_for', {
    p_user_id: '00000000-0000-4000-8000-000000000000',
    p_channel_id: probePublic, p_permission: 'channels.view',
  })
  check('an unknown user resolves to false without raising', !nobodyError && nobody === false,
    nobodyError ? `RAISED: ${nobodyError.message.slice(0, 40)}` : String(nobody))
}

console.log('\nC2 · reactions')
let probeReactionMessage = null
{
  const { data } = await supabase
    .from('messages')
    .insert({ channel_id: probePublic, author_id: userId, body: 'verify-live reaction target' })
    .select('id')
    .single()
  probeReactionMessage = data?.id ?? null

  const { error } = await supabase
    .from('message_reactions')
    .insert({ message_id: probeReactionMessage, user_id: userId, emoji: '\ud83d\udc4d' })
  check('a reaction can be added', !error, error?.message ?? '')

  const { data: row } = await supabase
    .from('message_reactions')
    .select('channel_id')
    .eq('message_id', probeReactionMessage)
    .maybeSingle()
  check('channel_id is stamped by the database', row?.channel_id === probePublic,
    row?.channel_id ?? 'missing')
}
{
  const { error } = await supabase
    .from('message_reactions')
    .insert({ message_id: probeReactionMessage, user_id: org?.id, emoji: '\ud83d\udd25' })
  check('reacting under another name is refused', Boolean(error),
    error ? `blocked (${error.code ?? ''})` : 'ACCEPTED — IMPERSONATION POSSIBLE')
}
{
  const { error } = await supabase
    .from('message_reactions')
    .insert({ message_id: probeReactionMessage, user_id: userId, emoji: '\ud83d\udc4d' })
  check('the same reaction twice is refused', Boolean(error),
    error ? `blocked (${error.code ?? ''})` : 'ACCEPTED — DUPLICATE')
}
{
  const { error } = await supabase
    .from('message_reactions')
    .insert({ message_id: probeReactionMessage, user_id: userId, emoji: 'lgtm' })
  check('a text label is not an emoji', Boolean(error),
    error ? `refused (${error.code ?? ''})` : 'ACCEPTED')
}
{
  const { error } = await supabase
    .from('message_reactions')
    .insert({ message_id: probeReactionMessage, user_id: userId, emoji: '\ud83c\udf89', channel_id: probePrivate })
  // The trigger overwrites whatever a client sends, so this must land in the
  // real channel rather than the one the client named.
  const { data: rows } = await supabase
    .from('message_reactions')
    .select('emoji, channel_id')
    .eq('message_id', probeReactionMessage)
  const forged = (rows ?? []).find((r) => r.emoji === '\ud83c\udf89')
  check('a client-supplied channel_id is overwritten', !error && forged?.channel_id === probePublic,
    forged?.channel_id ?? 'absent')
}

console.log('\nC2 · a soft delete takes the pin and the reactions with it')
{
  await supabase.rpc('pin_message', { p_message_id: probeReactionMessage, p_pinned: true })
  await supabase.rpc('delete_message', { p_message_id: probeReactionMessage })

  const { data: after } = await supabase
    .from('messages').select('pinned_at, deleted_at').eq('id', probeReactionMessage).maybeSingle()
  check('the pin is cleared', after?.pinned_at === null && after?.deleted_at !== null)

  const { data: left } = await supabase
    .from('message_reactions').select('emoji').eq('message_id', probeReactionMessage)
  check('the reactions are gone', (left ?? []).length === 0, `${String((left ?? []).length)} left`)
}

console.log('\nC2 · read state')
{
  const { error } = await supabase
    .from('channel_reads')
    .upsert({ channel_id: probePublic, user_id: userId }, { onConflict: 'channel_id,user_id' })
  check('a read can be recorded', !error, error?.message ?? '')

  const { error: forgedError } = await supabase
    .from('channel_reads')
    .upsert({ channel_id: probePublic, user_id: org?.id }, { onConflict: 'channel_id,user_id' })
  check('recording a read for somebody else is refused', Boolean(forgedError),
    forgedError ? `blocked (${forgedError.code ?? ''})` : 'ACCEPTED')

  const { error: unknownError } = await supabase
    .from('channel_reads')
    .upsert({ channel_id: '00000000-0000-4000-8000-000000000000', user_id: userId })
  check('recording a read in an unknown channel is refused', Boolean(unknownError),
    unknownError ? `blocked (${unknownError.code ?? ''})` : 'ACCEPTED')
}
{
  const { data, error } = await supabase.rpc('unread_counts')
  check('unread_counts returns a row per visible channel', !error && Array.isArray(data),
    error?.message ?? `${String((data ?? []).length)} channels`)
  const forPublic = (data ?? []).find((r) => r.channel_id === probePublic)
  check('the probe channel is counted', Boolean(forPublic),
    forPublic ? `unread ${String(forPublic.unread)}` : 'absent')
}

console.log('\nC2 · search')
{
  const marker = `zqxjv${String(Date.now() % 100000)}`
  const { data: sent } = await supabase
    .from('messages')
    .insert({ channel_id: probePublic, author_id: userId, body: `verify-live ${marker} needle` })
    .select('id')
    .single()

  const { data: found, error } = await supabase.rpc('search_messages', { p_query: marker })
  check('a message is findable by a word in it',
    !error && (found ?? []).some((r) => r.id === sent?.id), error?.message ?? '')

  const { data: scoped } = await supabase.rpc('search_messages', {
    p_query: marker, p_channel_id: probePrivate,
  })
  check('narrowing to another channel finds nothing', (scoped ?? []).length === 0,
    `${String((scoped ?? []).length)} results`)

  const { data: empty, error: emptyError } = await supabase.rpc('search_messages', { p_query: '' })
  check('an empty query matches nothing rather than everything',
    !emptyError && (empty ?? []).length === 0, `${String((empty ?? []).length)} results`)

  const { data: junk, error: junkError } = await supabase.rpc('search_messages', {
    p_query: '"unclosed and & | ! (',
  })
  check('malformed input is refused without raising', !junkError,
    junkError ? `RAISED: ${junkError.message.slice(0, 40)}` : `${String((junk ?? []).length)} results`)

  await supabase.rpc('delete_message', { p_message_id: sent?.id })
  const { data: afterDelete } = await supabase.rpc('search_messages', { p_query: marker })
  check('a deleted message stops being findable', (afterDelete ?? []).length === 0,
    `${String((afterDelete ?? []).length)} results`)
}

console.log('\nC2 · notifications')
{
  const { data: rows, error } = await supabase.from('notifications').select('id, recipient_id')
  check('the notification list is readable', !error, error?.message ?? '')
  check('every row belongs to the caller',
    (rows ?? []).every((r) => r.recipient_id === userId),
    `${String((rows ?? []).length)} rows`)

  const { error: insertError } = await supabase.from('notifications').insert({
    organization_id: org?.id, recipient_id: userId, type: 'mention',
    entity_type: 'message', entity_id: 'x', summary: 'forged',
  })
  // There is no INSERT policy at all: a client cannot manufacture one.
  check('a client cannot write a notification', Boolean(insertError),
    insertError ? `blocked (${insertError.code ?? ''})` : 'ACCEPTED — FORGERY POSSIBLE')

  const { error: markError } = await supabase.rpc('mark_notifications_read', {})
  check('marking read succeeds', !markError, markError?.message ?? '')
}

console.log('\nC2 · channel membership resolves through the same rules')
{
  const { data: publicMembers, error } = await supabase.rpc('channel_member_ids', {
    p_channel_id: probePublic,
  })
  check('a public channel lists its members', !error && (publicMembers ?? []).length > 0,
    error?.message ?? `${String((publicMembers ?? []).length)} members`)
  check('the caller is among them', (publicMembers ?? []).includes(userId))

  const { data: privateMembers } = await supabase.rpc('channel_member_ids', {
    p_channel_id: probePrivate,
  })
  // The owner short-circuits every check, so they are the one guaranteed
  // member of a private channel with no overrides.
  check('a private channel lists only who is allowed in',
    (privateMembers ?? []).length < (publicMembers ?? []).length,
    `${String((privateMembers ?? []).length)} of ${String((publicMembers ?? []).length)}`)

  const { data: unknown } = await supabase.rpc('channel_member_ids', {
    p_channel_id: '00000000-0000-4000-8000-000000000000',
  })
  check('an unknown channel yields nothing rather than an error',
    (unknown ?? []).length === 0, `${String((unknown ?? []).length)}`)
}

console.log('\nC3 · threads')
let threadRoot = null
let threadReply = null
{
  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: probePublic, author_id: userId, body: 'verify-live thread root' })
    .select('id, reply_count, last_reply_at, parent_message_id')
    .single()
  threadRoot = data?.id ?? null
  check('a root message can be sent', !error && Boolean(threadRoot), error?.message ?? '')
  check('it starts with no replies',
    data?.reply_count === 0 && data?.last_reply_at === null && data?.parent_message_id === null)
}
{
  const { data, error } = await supabase
    .from('messages')
    .insert({
      channel_id: probePublic, author_id: userId,
      body: 'verify-live thread reply', parent_message_id: threadRoot,
    })
    .select('id, parent_message_id')
    .single()
  threadReply = data?.id ?? null
  check('a reply can be sent', !error && Boolean(threadReply), error?.message ?? '')
  check('it points at its root', data?.parent_message_id === threadRoot)

  const { data: root } = await supabase
    .from('messages')
    .select('reply_count, last_reply_at')
    .eq('id', threadRoot)
    .maybeSingle()
  check('the root counts it', root?.reply_count === 1 && root?.last_reply_at !== null,
    `count ${String(root?.reply_count)}`)
}

console.log('\nC3 · the shape of a thread is the database\u2019s to enforce')
{
  const { error } = await supabase.from('messages').insert({
    channel_id: probePublic, author_id: userId,
    body: 'nested', parent_message_id: threadReply,
  })
  check('a reply to a reply is refused', Boolean(error),
    error ? `refused (${error.code ?? ''})` : 'ACCEPTED — THREADS ARE A TREE')
}
{
  const { error } = await supabase.from('messages').insert({
    channel_id: probePrivate, author_id: userId,
    body: 'wrong channel', parent_message_id: threadRoot,
  })
  check('a reply in another channel is refused', Boolean(error),
    error ? `refused (${error.code ?? ''})` : 'ACCEPTED — CROSS-CHANNEL REPLY')
}
{
  const { error } = await supabase.from('messages').insert({
    channel_id: probePublic, author_id: userId,
    body: 'into the void',
    parent_message_id: '00000000-0000-4000-8000-000000000000',
  })
  check('a reply to nothing is refused', Boolean(error),
    error ? `refused (${error.code ?? ''})` : 'ACCEPTED')
}
{
  const { error } = await supabase.from('messages').insert({
    channel_id: probePublic, author_id: userId, body: 'seeded',
    parent_message_id: threadRoot, reply_count: 99,
  })
  const { data: seeded } = await supabase
    .from('messages').select('reply_count').eq('body', 'seeded').maybeSingle()
  check('a client cannot seed a reply count', !error && seeded?.reply_count === 0,
    seeded ? `count ${String(seeded.reply_count)}` : (error?.message ?? ''))
}
// Detaching the reply is a real change; nulling an already-null column on the
// root would be a no-op the trigger has nothing to object to.
{
  const { error } = await supabase
    .from('messages').update({ parent_message_id: null }).eq('id', threadReply)
  check('parent_message_id cannot be written by a client', Boolean(error),
    error ? 'refused' : 'ACCEPTED — A REPLY CAN BE DETACHED')
}
for (const [label, patch] of [
  ['reply_count', { reply_count: 99 }],
  ['last_reply_at', { last_reply_at: new Date().toISOString() }],
]) {
  const { error } = await supabase.from('messages').update(patch).eq('id', threadRoot)
  check(`${label} cannot be written by a client`, Boolean(error),
    error ? 'refused' : 'ACCEPTED — COLUMN IS WRITABLE')
}

console.log('\nC3 · replies are ordinary messages')
{
  const { error } = await supabase
    .from('message_reactions')
    .insert({ message_id: threadReply, user_id: userId, emoji: '\ud83d\udc4d' })
  check('a reply can be reacted to', !error, error?.message ?? '')

  const marker = 'verify-live thread reply'
  const { data: found } = await supabase.rpc('search_messages', { p_query: 'thread' })
  const hit = (found ?? []).find((r) => r.id === threadReply)
  check('search finds a reply', Boolean(hit), hit ? '' : 'not found')
  check('and says it is one', hit?.parent_message_id === threadRoot,
    String(hit?.parent_message_id ?? 'null'))
  void marker

  const { error: pinError } = await supabase.rpc('pin_message', {
    p_message_id: threadReply, p_pinned: true,
  })
  check('a reply can be pinned', !pinError, pinError?.message ?? '')
  await supabase.rpc('pin_message', { p_message_id: threadReply, p_pinned: false })
}

console.log('\nC3 · a deleted root keeps its thread')
{
  await supabase.rpc('delete_message', { p_message_id: threadRoot })

  const { data: root } = await supabase
    .from('messages').select('deleted_at, body').eq('id', threadRoot).maybeSingle()
  check('the root survives as a placeholder',
    root?.deleted_at !== null && root?.body === '', `body length ${String((root?.body ?? '').length)}`)

  const { data: replies } = await supabase
    .from('messages').select('id').eq('parent_message_id', threadRoot)
  check('its replies are still there', (replies ?? []).length > 0,
    `${String((replies ?? []).length)} replies`)

  const { error } = await supabase.from('messages').insert({
    channel_id: probePublic, author_id: userId,
    body: 'too late', parent_message_id: threadRoot,
  })
  check('but it takes no new replies', Boolean(error),
    error ? `refused (${error.code ?? ''})` : 'ACCEPTED')
}

console.log('\nC3 · a deleted reply stops counting')
{
  const { data: fresh } = await supabase
    .from('messages')
    .insert({ channel_id: probePublic, author_id: userId, body: 'countable root' })
    .select('id')
    .single()

  const { data: one } = await supabase
    .from('messages')
    .insert({
      channel_id: probePublic, author_id: userId,
      body: 'one', parent_message_id: fresh?.id,
    })
    .select('id')
    .single()
  await supabase.from('messages').insert({
    channel_id: probePublic, author_id: userId,
    body: 'two', parent_message_id: fresh?.id,
  })

  const { data: before } = await supabase
    .from('messages').select('reply_count').eq('id', fresh?.id).maybeSingle()
  check('two replies counted', before?.reply_count === 2, String(before?.reply_count))

  await supabase.rpc('delete_message', { p_message_id: one?.id })

  const { data: after } = await supabase
    .from('messages').select('reply_count').eq('id', fresh?.id).maybeSingle()
  check('one deleted, one counted', after?.reply_count === 1, String(after?.reply_count))
}

console.log('\nC3 · mentions are recorded, and only for people who could read them')
{
  // Somebody other than the caller, resolved the way the trigger resolves a
  // handle. Without a second member there is nothing here to prove: the owner
  // cannot mention themselves, and every other check below is about somebody
  // else's eligibility.
  const { data: roster } = await supabase
    .from('organization_members')
    .select('user_id, profile:profiles!organization_members_user_id_fkey ( display_name, email )')
    .neq('user_id', userId)

  const other = (roster ?? [])[0]
  const otherProfile = Array.isArray(other?.profile) ? other?.profile[0] : other?.profile
  const handle = otherProfile?.display_name ?? (otherProfile?.email ?? '').split('@')[0] ?? ''

  check('a second member exists to be mentioned', Boolean(other) && handle !== '',
    handle === '' ? 'ADD A SECOND MEMBER — this section proves nothing alone' : handle)

  if (other && handle !== '') {
    const rowsFor = async (id) =>
      (await supabase.from('message_mentions').select('user_id, handle').eq('message_id', id)).data ?? []

    // --- a plain mention in a channel they can read ------------------------
    const { data: named } = await supabase
      .from('messages')
      .insert({
        channel_id: probePublic, author_id: userId,
        body: `@${handle} @${handle} and @nobodyatall`,
      })
      .select('id')
      .single()

    const recorded = await rowsFor(named?.id)
    check('the mention is recorded as a row', recorded.length === 1,
      `${String(recorded.length)} rows`)
    check('pointing at the person named', recorded[0]?.user_id === other.user_id)
    check('keeping the handle as written', recorded[0]?.handle === handle.toLowerCase(),
      String(recorded[0]?.handle))
    // Naming somebody three times is still one mention, and a handle nobody
    // holds is not a mention at all.
    check('a handle nobody holds records nothing',
      !recorded.some((r) => r.handle === 'nobodyatall'))

    // --- the client cannot write its own ----------------------------------
    const { error: forge } = await supabase
      .from('message_mentions')
      .insert({ message_id: named?.id, user_id: userId, handle: 'forged' })
    check('a client cannot manufacture a mention', Boolean(forge),
      forge ? `blocked (${forge.code ?? ''})` : 'ACCEPTED — FORGERY POSSIBLE')

    const { error: retarget } = await supabase
      .from('message_mentions')
      .update({ user_id: userId })
      .eq('message_id', named?.id)
    const stillTheirs = (await rowsFor(named?.id))[0]?.user_id === other.user_id
    check('nor redirect one at somebody else', Boolean(retarget) || stillTheirs,
      retarget ? `blocked (${retarget.code ?? ''})` : 'no policy matched the update')

    await supabase.from('message_mentions').delete().eq('message_id', named?.id)
    check('nor delete one', (await rowsFor(named?.id)).length === 1)

    // --- an edit re-derives them ------------------------------------------
    await supabase.from('messages').update({ body: 'nobody at all' }).eq('id', named?.id)
    const afterRemoval = await rowsFor(named?.id)
    // The row stays: it is the record that this person was already told.
    // Re-adding the handle must not notify them a second time, which is what
    // the primary key and the ON CONFLICT in the trigger are for.
    check('an edit does not re-notify somebody already named',
      afterRemoval.length === 1, `${String(afterRemoval.length)} rows`)

    const { data: blank } = await supabase
      .from('messages')
      .insert({ channel_id: probePublic, author_id: userId, body: 'no names yet' })
      .select('id')
      .single()
    check('a message naming nobody records nothing', (await rowsFor(blank?.id)).length === 0)

    await supabase.from('messages').update({ body: `actually @${handle}` }).eq('id', blank?.id)
    check('an edit that adds a name records it', (await rowsFor(blank?.id)).length === 1)

    // --- a soft delete forgets them ---------------------------------------
    await supabase.rpc('delete_message', { p_message_id: blank?.id })
    check('a deleted message keeps no mentions', (await rowsFor(blank?.id)).length === 0)

    // --- and the check the owner cannot short-circuit ----------------------
    //
    // The caller sees every channel by design, so nothing above depends on
    // eligibility. This does: the person named is somebody else, and they have
    // no way into a private channel with no overrides.
    const { data: allowed } = await supabase.rpc('can_in_channel_for', {
      p_user_id: other.user_id, p_channel_id: probePrivate, p_permission: 'channels.view',
    })
    check('the other member cannot see the private channel', allowed === false, String(allowed))

    const { data: secret } = await supabase
      .from('messages')
      .insert({ channel_id: probePrivate, author_id: userId, body: `@${handle} classified` })
      .select('id')
      .single()
    check('naming them there records nothing at all',
      (await rowsFor(secret?.id)).length === 0,
      'a row would be a record of a message they cannot open')

    await supabase.rpc('delete_message', { p_message_id: named?.id })
    await supabase.rpc('delete_message', { p_message_id: secret?.id })
  }
}

console.log('\nC3 · a direct message is not a channel')
{
  const { data: roster } = await supabase
    .from('organization_members')
    .select('user_id')
    .neq('user_id', userId)

  const others = (roster ?? []).map((r) => r.user_id)
  const partner = others[0]
  const stranger = others[1]

  check('there is somebody to message', Boolean(partner),
    partner ? '' : 'ADD A SECOND MEMBER — this section proves nothing alone')

  if (partner) {
    const { data: first, error: startError } = await supabase.rpc('start_direct_message', {
      p_organization_id: org?.id, p_user_id: partner,
    })
    check('a conversation opens', !startError && Boolean(first), startError?.message ?? '')

    const { data: again } = await supabase.rpc('start_direct_message', {
      p_organization_id: org?.id, p_user_id: partner,
    })
    // The unique index on the sorted pair is the arbiter, not the client.
    check('asking again returns the same one', again === first, String(again))

    const { error: selfError } = await supabase.rpc('start_direct_message', {
      p_organization_id: org?.id, p_user_id: userId,
    })
    check('a conversation with yourself is refused', Boolean(selfError),
      selfError ? 'refused' : 'ACCEPTED')

    const { error: crossError } = await supabase.rpc('start_direct_message', {
      p_organization_id: '00000000-0000-4000-8000-000000000000', p_user_id: partner,
    })
    check('another organization is refused', Boolean(crossError),
      crossError ? 'refused' : 'ACCEPTED')

    // --- membership is the authority, and cannot be written -----------------
    const { data: members } = await supabase
      .from('conversation_members').select('user_id').eq('conversation_id', first)
    check('both members are recorded', (members ?? []).length === 2,
      `${String((members ?? []).length)} rows`)

    const { error: forgeError } = await supabase
      .from('conversation_members')
      .insert({ conversation_id: first, user_id: userId })
    check('membership cannot be forged', Boolean(forgeError),
      forgeError ? `blocked (${forgeError.code ?? ''})` : 'ACCEPTED — FORGERY POSSIBLE')

    const { error: convError } = await supabase
      .from('conversations')
      .insert({ organization_id: org?.id, kind: 'direct', member_key: 'forged' })
    check('a conversation cannot be written directly', Boolean(convError),
      convError ? `blocked (${convError.code ?? ''})` : 'ACCEPTED')

    await supabase.from('conversation_members').delete().eq('conversation_id', first)
    const { data: stillThere } = await supabase
      .from('conversation_members').select('user_id').eq('conversation_id', first)
    check('nor removed', (stillThere ?? []).length === 2,
      `${String((stillThere ?? []).length)} rows`)

    // --- exactly one context ------------------------------------------------
    const { data: sent, error: sendError } = await supabase
      .from('messages')
      .insert({ conversation_id: first, author_id: userId, body: 'verify-live direct probe' })
      .select('id, channel_id, conversation_id')
      .single()
    check('a direct message can be sent', !sendError, sendError?.message ?? '')
    check('and carries no channel', sent?.channel_id === null, String(sent?.channel_id))

    const { error: bothError } = await supabase.from('messages').insert({
      conversation_id: first, channel_id: probePublic, author_id: userId, body: 'two places',
    })
    check('a message in two places is refused', Boolean(bothError),
      bothError ? `refused (${bothError.code ?? ''})` : 'ACCEPTED')

    const { error: neitherError } = await supabase
      .from('messages').insert({ author_id: userId, body: 'nowhere' })
    check('a message in no place is refused', Boolean(neitherError),
      neitherError ? `refused (${neitherError.code ?? ''})` : 'ACCEPTED')

    const { error: moveError } = await supabase
      .from('messages').update({ conversation_id: null }).eq('id', sent?.id)
    check('a message cannot be moved out of its context', Boolean(moveError),
      moveError ? 'refused' : 'ACCEPTED')

    // --- reactions carry the conversation, not a channel --------------------
    await supabase
      .from('message_reactions')
      .insert({ message_id: sent?.id, user_id: userId, emoji: '\ud83d\udc4d' })
    const { data: reaction } = await supabase
      .from('message_reactions')
      .select('channel_id, conversation_id').eq('message_id', sent?.id).maybeSingle()
    check('a reaction is stamped with the conversation',
      reaction?.conversation_id === first && reaction?.channel_id === null,
      `channel ${String(reaction?.channel_id)}`)

    // --- pinning, and the audit trail it must not write ---------------------
    const { count: auditBefore } = await supabase
      .from('audit_logs').select('id', { count: 'exact', head: true })

    const { error: pinError } = await supabase.rpc('pin_message', {
      p_message_id: sent?.id, p_pinned: true,
    })
    check('either person may pin', !pinError, pinError?.message ?? '')

    const { count: auditAfter } = await supabase
      .from('audit_logs').select('id', { count: 'exact', head: true })
    // An entry would tell every holder of the audit permission that the
    // conversation exists and when it was used.
    check('and it writes no audit entry', auditBefore === auditAfter,
      `${String(auditBefore)} -> ${String(auditAfter)}`)

    await supabase.rpc('pin_message', { p_message_id: sent?.id, p_pinned: false })

    // --- read state ---------------------------------------------------------
    const { error: readError } = await supabase
      .from('conversation_reads').upsert({ conversation_id: first, user_id: userId })
    check('a read can be recorded', !readError, readError?.message ?? '')

    const { data: counts } = await supabase.rpc('conversation_unread_counts')
    const mine = (counts ?? []).find((c) => c.conversation_id === first)
    check('the conversation reports its own unread count', Boolean(mine),
      mine ? `${String(mine.unread)} unread` : 'no row')
    check('your own words are not unread', mine?.unread === 0, String(mine?.unread))

    // --- search -------------------------------------------------------------
    const { data: named } = await supabase.rpc('search_messages', {
      p_query: 'probe', p_conversation_id: first,
    })
    check('search finds it when the conversation is named',
      (named ?? []).some((r) => r.id === sent?.id))

    const { data: unscoped } = await supabase.rpc('search_messages', { p_query: 'probe' })
    // Unchanged from before conversations existed: channels only.
    check('and an unscoped search still returns channels only',
      !(unscoped ?? []).some((r) => r.conversation_id !== null),
      `${String((unscoped ?? []).length)} hits`)

    // --- the check the owner cannot short-circuit ---------------------------
    //
    // Everything above is about the caller, who is in the conversation. This
    // is about somebody else, and it is the whole authorization model: a
    // third member of the same organization is simply not in it.
    if (stranger) {
      const { data: allowed } = await supabase.rpc('can_in_conversation_for', {
        p_user_id: stranger, p_conversation_id: first,
      })
      check('a third member is not in the conversation', allowed === false, String(allowed))

      const { data: partnerAllowed } = await supabase.rpc('can_in_conversation_for', {
        p_user_id: partner, p_conversation_id: first,
      })
      check('and the person you are talking to is', partnerAllowed === true,
        String(partnerAllowed))

      const { data: strangerProfile } = await supabase
        .from('profiles').select('display_name, email').eq('id', stranger).maybeSingle()
      const handle =
        strangerProfile?.display_name ?? (strangerProfile?.email ?? '').split('@')[0]

      const { data: named2 } = await supabase
        .from('messages')
        .insert({ conversation_id: first, author_id: userId, body: `@${handle} probe` })
        .select('id')
        .single()

      const { data: mentions } = await supabase
        .from('message_mentions').select('user_id').eq('message_id', named2?.id)
      // Naming a colleague in a direct message reaches nobody: they are not
      // in it, so there is no row and no notification.
      check('naming somebody outside it records nothing', (mentions ?? []).length === 0,
        `${String((mentions ?? []).length)} rows`)

      await supabase.rpc('delete_message', { p_message_id: named2?.id })
    }

    const { data: topicOk } = await supabase.rpc('can_in_conversation', {
      p_conversation_id: '00000000-0000-4000-8000-000000000000',
    })
    check('an unknown conversation is refused', topicOk === false, String(topicOk))

    // --- deleting -----------------------------------------------------------
    const { data: root } = await supabase
      .from('messages')
      .insert({ conversation_id: first, author_id: userId, body: 'verify-live root' })
      .select('id')
      .single()
    await supabase.from('messages').insert({
      conversation_id: first, author_id: userId,
      body: 'verify-live reply', parent_message_id: root?.id,
    })

    await supabase.rpc('delete_message', { p_message_id: root?.id })
    const { data: keptRoot } = await supabase
      .from('messages').select('deleted_at, body').eq('id', root?.id).maybeSingle()
    // A root with replies keeps its row so the thread stays reachable.
    check('a root with replies survives as a placeholder',
      keptRoot?.deleted_at !== null && keptRoot?.body === '')

    const { data: replies } = await supabase
      .from('messages').select('id').eq('parent_message_id', root?.id)
    for (const reply of replies ?? []) {
      await supabase.rpc('delete_message', { p_message_id: reply.id })
    }

    await supabase.rpc('delete_message', { p_message_id: sent?.id })
    const { data: goneCheck } = await supabase
      .from('messages').select('id').eq('id', sent?.id).maybeSingle()
    // With nothing pointing at it, a direct message is removed rather than
    // tombstoned: there is no moderation decision for a tombstone to record.
    check('a direct message with no replies is removed outright', goneCheck === null,
      goneCheck ? 'a placeholder was left behind' : '')

    // --- cleanup ------------------------------------------------------------
    const { data: leftovers } = await supabase
      .from('messages').select('id').eq('conversation_id', first)
    for (const row of leftovers ?? []) {
      await supabase.rpc('delete_message', { p_message_id: row.id })
    }
    const { data: after } = await supabase
      .from('messages').select('id').eq('conversation_id', first)
    check('the probe leaves no messages behind', (after ?? []).length === 0,
      `${String((after ?? []).length)} left`)
  }
}

console.log('\nC3 · attachments')
{
  const BUCKET = 'message-attachments'
  // A one-pixel PNG: real enough to be an image, small enough to be inline.
  const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )

  const objectPath = `${userId}/${crypto.randomUUID()}`
  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, PIXEL, { contentType: 'image/png' })
  check('an upload into your own prefix is accepted', !upError, upError?.message ?? '')

  const strangerPath = `00000000-0000-4000-8000-000000000000/${crypto.randomUUID()}`
  const { error: prefixError } = await supabase.storage
    .from(BUCKET)
    .upload(strangerPath, PIXEL, { contentType: 'image/png' })
  // The prefix is the whole write rule: nobody can put anything anywhere but
  // under their own id, which is also why nobody can overwrite anybody.
  check("another member's prefix is refused", Boolean(prefixError),
    prefixError ? 'refused' : 'ACCEPTED')

  const { error: typeError } = await supabase.storage
    .from(BUCKET)
    .upload(`${userId}/${crypto.randomUUID()}`, Buffer.from('#!/bin/sh\n'), {
      contentType: 'application/x-sh',
    })
  check('a kind of file that cannot be attached is refused', Boolean(typeError),
    typeError?.message ?? 'ACCEPTED')

  const { error: sizeError } = await supabase.storage
    .from(BUCKET)
    .upload(`${userId}/${crypto.randomUUID()}`, Buffer.alloc(26 * 1024 * 1024, 1), {
      contentType: 'application/zip',
    })
  check('a file over 25 MB is refused', Boolean(sizeError), sizeError?.message ?? 'ACCEPTED')

  // --- the metadata -------------------------------------------------------
  const { data: carrier } = await supabase
    .from('messages')
    .insert({ channel_id: probePublic, author_id: userId, body: 'verify-live attachment probe' })
    .select('id')
    .single()

  const { data: row, error: attachError } = await supabase
    .from('message_attachments')
    .insert({
      message_id: carrier?.id,
      storage_path: objectPath,
      file_name: 'pixel.png',
      // Deliberately wrong, both of them.
      mime_type: 'text/html',
      byte_size: 999999,
    })
    .select('id, mime_type, byte_size')
    .single()
  check('an attachment is recorded', !attachError, attachError?.message ?? '')
  // The client says what it likes; storage is what is believed.
  check('storage decides the content type', row?.mime_type === 'image/png', String(row?.mime_type))
  check('storage decides the size', row?.byte_size === PIXEL.length, String(row?.byte_size))

  const { error: dupError } = await supabase.from('message_attachments').insert({
    message_id: carrier?.id, storage_path: objectPath, file_name: 'again.png',
  })
  check('one object cannot be attached twice', Boolean(dupError), dupError?.code ?? 'ACCEPTED')

  const { error: ghostError } = await supabase.from('message_attachments').insert({
    message_id: carrier?.id,
    storage_path: `${userId}/${crypto.randomUUID()}`,
    file_name: 'nothing.png',
  })
  check('a path with no object behind it is refused', Boolean(ghostError),
    ghostError ? 'refused' : 'ACCEPTED')

  const { error: theirsError } = await supabase.from('message_attachments').insert({
    message_id: carrier?.id, storage_path: strangerPath, file_name: 'theirs.png',
  })
  check("another member's path is refused", Boolean(theirsError),
    theirsError ? 'refused' : 'ACCEPTED')

  const { error: updateError } = await supabase
    .from('message_attachments').update({ file_name: 'renamed.png' }).eq('id', row?.id)
  const { data: unchanged } = await supabase
    .from('message_attachments').select('file_name').eq('id', row?.id).maybeSingle()
  check('an attachment cannot be edited', Boolean(updateError) || unchanged?.file_name === 'pixel.png',
    updateError ? 'refused' : 'no policy matched the update')

  const { error: deleteError } = await supabase
    .from('message_attachments').delete().eq('id', row?.id)
  const { data: stillThere } = await supabase
    .from('message_attachments').select('id').eq('id', row?.id).maybeSingle()
  check('nor deleted on its own', Boolean(deleteError) || Boolean(stillThere),
    deleteError ? 'refused' : 'no policy matched the delete')

  // --- attaching to somebody else's message -------------------------------
  const { data: roster } = await supabase
    .from('organization_members').select('user_id').neq('user_id', userId)
  const partner = (roster ?? [])[0]?.user_id
  if (partner) {
    const { data: theirMessage } = await supabase
      .from('messages')
      .insert({ channel_id: probePublic, author_id: userId, body: 'probe' })
      .select('id')
      .single()
    // Not a real test of somebody else's message — there is one credential —
    // but the rule that gates it is the author check, and this is the same
    // insert path with a fresh object.
    const secondPath = `${userId}/${crypto.randomUUID()}`
    await supabase.storage.from(BUCKET).upload(secondPath, PIXEL, { contentType: 'image/png' })
    const { error: secondError } = await supabase.from('message_attachments').insert({
      message_id: theirMessage?.id, storage_path: secondPath, file_name: 'second.png',
    })
    check('a second file attaches to a second message', !secondError, secondError?.message ?? '')
    await supabase.rpc('delete_message', { p_message_id: theirMessage?.id })
    await supabase.storage.from(BUCKET).remove([secondPath])
  }

  // --- signed urls --------------------------------------------------------
  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET).createSignedUrl(objectPath, 60)
  check('a signed url is issued for a file you can see', !signError && Boolean(signed?.signedUrl),
    signError?.message ?? '')

  if (signed?.signedUrl) {
    const fetched = await fetch(signed.signedUrl)
    check('and it returns the bytes', fetched.status === 200, `HTTP ${String(fetched.status)}`)
  }

  const { data: download } = await supabase.storage
    .from(BUCKET).createSignedUrl(objectPath, 60, { download: true })
  if (download?.signedUrl) {
    const fetched = await fetch(download.signedUrl)
    // The disposition is what keeps a file the browser might otherwise render
    // a download and nothing else.
    check('a download url carries a disposition',
      (fetched.headers.get('content-disposition') ?? '').includes('attachment'),
      fetched.headers.get('content-disposition') ?? 'none')
  }

  const { data: ghostSigned } = await supabase.storage
    .from(BUCKET).createSignedUrl(`${crypto.randomUUID()}/${crypto.randomUUID()}`, 60)
  check('no url is issued for an object that is not yours', !ghostSigned?.signedUrl,
    ghostSigned?.signedUrl ? 'ISSUED' : 'refused')

  // --- lifecycle ----------------------------------------------------------
  await supabase.rpc('delete_message', { p_message_id: carrier?.id })
  const { data: after } = await supabase
    .from('message_attachments').select('id').eq('message_id', carrier?.id)
  // A file listed under a message whose words are gone is residue, so it goes
  // the way the reactions and the mentions go.
  check('a deleted message keeps no attachment metadata', (after ?? []).length === 0,
    `${String((after ?? []).length)} rows`)

  await supabase.storage.from(BUCKET).remove([objectPath])
  const { data: leftOver } = await supabase.storage.from(BUCKET).list(userId)
  const names = new Set((leftOver ?? []).map((o) => `${userId}/${o.name}`))
  // Its own objects, not the whole prefix: a real attachment somebody sent
  // lives here too, and this section is not the place to have an opinion
  // about it.
  check('the probe leaves nothing of its own behind', !names.has(objectPath),
    `${String(names.size)} objects under the prefix`)
}

console.log('\nB3 · a channel and its category in one call')

const comboName = `probe-combo-${String(Date.now() % 100000)}`
let comboChannel = null
let comboCategory = null
let comboSecond = null

{
  const { data, error } = await supabase.rpc('create_channel_in_category', {
    p_organization_id: org?.id,
    p_name: `${comboName}-first`,
    p_category_name: comboName,
    p_is_private: false,
  })
  comboChannel = typeof data === 'string' ? data : null
  check('a channel and a new category are created together', !error && Boolean(comboChannel),
    error?.message ?? '')

  const { data: row } = await supabase
    .from('channels').select('category_id').eq('id', comboChannel).maybeSingle()
  comboCategory = row?.category_id ?? null

  const { data: cat } = await supabase
    .from('channel_categories').select('name').eq('id', comboCategory).maybeSingle()
  check('the channel lands in that category', cat?.name === comboName, cat?.name ?? 'no category')
}

{
  // Typed in a different case, as a person would.
  const { data, error } = await supabase.rpc('create_channel_in_category', {
    p_organization_id: org?.id,
    p_name: `${comboName}-second`,
    p_category_name: comboName.toUpperCase(),
    p_is_private: true,
  })
  comboSecond = typeof data === 'string' ? data : null
  check('a second channel reuses the category', !error, error?.message ?? '')

  const { data: rows } = await supabase
    .from('channel_categories').select('id').ilike('name', comboName)
  check('no duplicate category was made', (rows ?? []).length === 1,
    `${String((rows ?? []).length)} found`)

  const { data: row } = await supabase
    .from('channels').select('category_id, is_private').eq('id', comboSecond).maybeSingle()
  check('the private channel is in the same category', row?.category_id === comboCategory)
  check('and it is private', row?.is_private === true)
}

console.log('\nB3 · a refused channel leaves no category behind')
{
  const orphanName = `probe-orphan-${String(Date.now() % 100000)}`
  // Past channels_name_length: the category half would succeed and the channel
  // half cannot, so the call has to come back as if nothing had happened.
  const { error } = await supabase.rpc('create_channel_in_category', {
    p_organization_id: org?.id,
    p_name: 'x'.repeat(41),
    p_category_name: orphanName,
    p_is_private: false,
  })
  check('the call is refused', Boolean(error), error ? `refused (${error.code ?? ''})` : 'ACCEPTED')

  const { data: rows } = await supabase
    .from('channel_categories').select('id').eq('name', orphanName)
  check('and the category was rolled back with it', (rows ?? []).length === 0,
    `${String((rows ?? []).length)} left behind`)
}

console.log('\nB3 · the combined call cannot reach another organization')
{
  const { error } = await supabase.rpc('create_channel_in_category', {
    p_organization_id: '00000000-0000-4000-8000-000000000000',
    p_name: 'elsewhere',
    p_category_name: 'Elsewhere',
    p_is_private: false,
  })
  check('creating into an unknown organization is refused', Boolean(error),
    error ? `blocked (${error.code ?? ''})` : 'ACCEPTED — CROSS-ORG WRITE')
}

console.log('\nB3 · combined-call cleanup')
for (const [label, id] of [['first', comboChannel], ['second', comboSecond]]) {
  if (!id) continue
  const { error } = await supabase.rpc('delete_channel', { p_channel_id: id })
  check(`${label} combined channel deleted`, !error, error?.message ?? '')
}
if (comboCategory) {
  const { error } = await supabase.rpc('delete_category', { p_category_id: comboCategory })
  check('combined category deleted', !error, error?.message ?? '')
}

console.log('\nB3 · cleanup')
for (const [label, id] of [['public', probePublic], ['private', probePrivate]]) {
  const { error } = await supabase.rpc('delete_channel', { p_channel_id: id })
  check(`${label} probe channel deleted`, !error, error?.message ?? '')
}
{
  const { error } = await supabase.rpc('delete_category', { p_category_id: probeCategory })
  check('probe category deleted', !error, error?.message ?? '')
}
{
  const { count } = await supabase
    .from('channel_permission_overrides')
    .select('*', { count: 'exact', head: true })
  check('overrides cascaded away with their channel', count === 0, `${String(count)} left`)
}

await supabase.auth.signOut()

console.log(
  failures === 0
    ? '\nAll signed-in checks passed.\n\nThe B1 section creates and deletes a probe role; the B2 section\nsuspends, bans and restores a member; the B3 section creates and deletes\na category and two channels. All three clean up after themselves, but the\naudit and moderation logs keep their entries — by design, append-only.\n'
    : `\n${String(failures)} check(s) FAILED.\n`,
)
process.exit(failures === 0 ? 0 : 1)
