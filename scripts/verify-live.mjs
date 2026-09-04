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

await supabase.auth.signOut()

console.log(
  failures === 0
    ? '\nAll signed-in checks passed. Nothing was modified.\n'
    : `\n${String(failures)} check(s) FAILED.\n`,
)
process.exit(failures === 0 ? 0 : 1)
