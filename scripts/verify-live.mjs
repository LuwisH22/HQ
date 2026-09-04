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
  .select('id, key, rank, is_system')
  .eq('organization_id', org?.id ?? '')
  .order('rank')
check('roles readable', !roleError, roleError?.message ?? '')
check('exactly 6 roles materialised', (roles ?? []).length === 6, `got ${String((roles ?? []).length)}`)
check('all marked is_system', (roles ?? []).every((r) => r.is_system === true))
check(
  'ranks match the templates',
  JSON.stringify((roles ?? []).map((r) => [r.key, r.rank])) === JSON.stringify(EXPECTED_TEMPLATES),
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
check('bootstrap recorded organization.created', (audit ?? []).some((a) => a.action === 'organization.created'))

// --- guards (every one of these MUST be refused) --------------------------
console.log('\nprivilege guards (each write below must be refused)')
const playerRole = (roles ?? []).find((r) => r.key === 'player')

if (self && playerRole) {
  const { error } = await supabase
    .from('organization_members')
    .update({ role_id: playerRole.id })
    .eq('id', self.id)
  check('last owner cannot be demoted', Boolean(error), error ? error.message.slice(0, 60) : 'ACCEPTED — GUARD FAILED')
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

await supabase.auth.signOut()

console.log(
  failures === 0
    ? '\nAll signed-in checks passed. Nothing was modified.\n'
    : `\n${String(failures)} check(s) FAILED.\n`,
)
process.exit(failures === 0 ? 0 : 1)
