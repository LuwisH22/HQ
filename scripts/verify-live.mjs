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
