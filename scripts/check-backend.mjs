/**
 * Live backend preflight.
 *
 * Verifies, against whatever project `.env` points at, that the security model
 * this app depends on is actually in force — before anyone signs in and before
 * the E2E suite runs. Everything here is checked as an ANONYMOUS caller, which
 * is exactly the position an attacker holding the publishable key is in.
 *
 * The publishable/anon key is public by design; it is only safe because of RLS
 * and the table grants. This script is what proves that claim rather than
 * assuming it.
 *
 *   node scripts/check-backend.mjs
 *
 * Exits non-zero if any check fails.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Minimal .env reader: values may contain spaces, so this does not go through
// the shell.
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

const env = { ...readEnvFile('.env'), ...process.env }
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('check-backend: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set.')
  process.exit(1)
}

const TABLES = [
  'organizations',
  'profiles',
  'permissions',
  'role_templates',
  'role_template_permissions',
  'roles',
  'role_permissions',
  'organization_members',
  'invitations',
  'audit_logs',
  'message_reactions',
  'channel_reads',
  'notifications',
  'message_mentions',
  'conversations',
  'conversation_members',
  'conversation_reads',
  'message_attachments',
]

/** Functions that must never be callable without a session. */
const PRIVILEGED_RPCS = ['bootstrap_organization', 'log_audit_event', 'hash_invitation_token']

const supabase = createClient(url, key, { auth: { persistSession: false } })

let failures = 0
function check(label, passed, detail) {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${detail ?? ''}`)
  if (!passed) failures += 1
}

console.log(`\nchecking ${url}\n`)

// --- 1. the client can reach the project with this key ---------------------
console.log('client')
const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
check('supabase-js reaches the auth endpoint', !sessionError, sessionError?.message ?? '')
check('no session while signed out', sessionData?.session === null)

// --- 2. authentication is closed -------------------------------------------
console.log('\nauthentication')
const { error: loginError } = await supabase.auth.signInWithPassword({
  email: 'nobody.preflight@lfg.test',
  password: 'not-a-real-password-nobody-uses',
})
check('unknown credentials are refused', Boolean(loginError), loginError?.message ?? '')

const { error: signUpError } = await supabase.auth.signUp({
  email: 'nobody.preflight2@lfg.test',
  password: 'not-a-real-password-nobody-uses',
})
check(
  'public signup is disabled server-side',
  /signup|not allowed|disabled/i.test(signUpError?.message ?? ''),
  signUpError?.message ?? 'SIGNUP SUCCEEDED — close it in the dashboard',
)

// --- 3. no table leaks a single row to an anonymous caller -----------------
console.log('\nanonymous reads (every one must be refused)')
for (const table of TABLES) {
  const { data, error } = await supabase.from(table).select('*').limit(1)
  const leaked = !error && (data?.length ?? 0) > 0
  check(
    table,
    !leaked,
    error ? `blocked (${error.code ?? 'error'})` : `returned ${String(data?.length ?? 0)} rows`,
  )
}

// --- 4. no table accepts an anonymous write --------------------------------
console.log('\nanonymous writes (every one must be refused)')
for (const table of ['organizations', 'profiles', 'organization_members', 'audit_logs']) {
  const { error } = await supabase.from(table).insert({})
  check(
    `insert into ${table}`,
    Boolean(error),
    error ? `blocked (${error.code ?? 'error'})` : 'ACCEPTED',
  )
}

// --- 5. privileged routines are not exposed --------------------------------
console.log('\nprivileged functions (must not be reachable)')
for (const fn of PRIVILEGED_RPCS) {
  const { error } = await supabase.rpc(fn, {})
  check(fn, Boolean(error), error ? `blocked (${error.code ?? 'error'})` : 'REACHABLE')
}
// These are SECURITY DEFINER and bypass RLS internally, so they must not be
// reachable without a session even though they currently return nothing.
const ORG = '00000000-0000-4000-8000-000000000000'
const HELPERS = [
  ['is_org_member', { p_organization_id: ORG }],
  ['has_org_permission', { p_organization_id: ORG, p_permission: 'members.view' }],
  ['my_role_rank', { p_organization_id: ORG }],
  ['shares_organization_with', { p_user_id: ORG }],
  ['my_permissions', { p_organization_id: ORG }],
  ['create_invitation', { p_organization_id: ORG, p_email: 'x@y.z', p_role_id: ORG, p_token: 't' }],
  ['accept_invitation', { p_token: 'nope' }],
  ['revoke_invitation', { p_invitation_id: ORG }],
  // Phase 1.5 · B1. Every one of these can change who may do what, so an
  // anonymous caller must not reach them at all.
  ['is_org_owner', { p_organization_id: ORG }],
  ['create_role', { p_organization_id: ORG, p_name: 'probe', p_rank: 900 }],
  ['update_role', { p_role_id: ORG, p_name: 'probe' }],
  ['set_role_rank', { p_role_id: ORG, p_rank: 900 }],
  ['delete_role', { p_role_id: ORG }],
  ['set_role_permissions', { p_role_id: ORG, p_permission_keys: ['organization.view'] }],
  ['assign_role_to_member', { p_member_id: ORG, p_role_id: ORG }],
  ['unassign_role_from_member', { p_member_id: ORG, p_role_id: ORG }],
  // Phase 1.5 · B2.
  ['is_effectively_active', { p_status: 'active', p_suspended_until: null }],
  ['suspend_member', { p_member_id: ORG, p_reason: 'probe', p_days: 1 }],
  ['unsuspend_member', { p_member_id: ORG, p_reason: 'probe' }],
  ['ban_member', { p_member_id: ORG, p_reason: 'probe' }],
  ['unban_member', { p_member_id: ORG, p_reason: 'probe' }],
  // Phase 1.5 · B3. can_in_channel decides who sees a private channel, so an
  // anonymous caller must not be able to ask it anything.
  ['can_in_channel', { p_channel_id: ORG, p_permission: 'channels.view' }],
  ['can_see_category', { p_category_id: ORG }],
  ['channel_organization', { p_channel_id: ORG }],
  ['create_category', { p_organization_id: ORG, p_name: 'probe' }],
  ['update_category', { p_category_id: ORG, p_name: 'probe' }],
  ['delete_category', { p_category_id: ORG }],
  ['reorder_categories', { p_organization_id: ORG, p_ids: [ORG] }],
  ['create_channel', { p_organization_id: ORG, p_name: 'probe' }],
  ['update_channel', { p_channel_id: ORG, p_name: 'probe' }],
  ['delete_channel', { p_channel_id: ORG }],
  ['reorder_channels', { p_organization_id: ORG, p_ids: [ORG] }],
  ['set_channel_override', { p_channel_id: ORG, p_role_id: ORG,
                             p_permission_key: 'channels.view', p_effect: 'allow' }],
  // Phase 2 · C1.
  ['delete_message', { p_message_id: ORG, p_reason: 'probe' }],
  ['pin_message', { p_message_id: ORG, p_pinned: true }],
  ['can_join_channel_topic', { p_topic: 'channel:' + ORG, p_permission: 'channels.view' }],
  ['create_channel_in_category', { p_organization_id: ORG, p_name: 'probe',
                                  p_category_name: 'probe', p_is_private: false }],
  // Phase 2 · C2.
  ['unread_counts', {}],
  ['search_messages', { p_query: 'probe' }],
  ['channel_member_ids', { p_channel_id: ORG }],
  ['mark_notifications_read', {}],
  ['can_in_channel_for', { p_user_id: ORG, p_channel_id: ORG, p_permission: 'channels.view' }],
  ['has_org_permission_for', { p_user_id: ORG, p_organization_id: ORG,
                              p_permission: 'channels.view' }],
  // Phase 2 · C3.
  ['can_in_conversation', { p_conversation_id: ORG }],
  ['can_in_conversation_for', { p_user_id: ORG, p_conversation_id: ORG }],
  ['can_join_conversation_topic', { p_topic: 'dm:' + ORG }],
  ['start_direct_message', { p_organization_id: ORG, p_user_id: ORG }],
  ['conversation_unread_counts', {}],
]
for (const [fn, args] of HELPERS) {
  const { error } = await supabase.rpc(fn, args)
  check(fn, Boolean(error), error ? `blocked (${error.code ?? 'error'})` : 'REACHABLE')
}

// --- 6. the attachment bucket is private and closed ------------------------
console.log('\nstorage (the bucket must be private and shut to anonymous callers)')
{
  const BUCKET = 'message-attachments'

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl('anything/at-all')
  const probe = await fetch(pub.publicUrl)
  // A public bucket would serve this. A private one refuses whatever the path.
  check('the bucket serves nothing publicly', probe.status >= 400, `HTTP ${String(probe.status)}`)

  const { data: listed, error: listError } = await supabase.storage.from(BUCKET).list()
  check('anonymous listing is refused', Boolean(listError) || (listed ?? []).length === 0,
    listError ? `blocked (${listError.message})` : `returned ${String((listed ?? []).length)}`)

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl('anything/at-all', 60)
  check('anonymous signing is refused', Boolean(signError) || !signed?.signedUrl,
    signError ? 'blocked' : 'ISSUED')

  // An allowed content type, so what refuses this is the policy rather than
  // the bucket's type list.
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(`anything/${String(Date.now())}`, new Blob(['x'], { type: 'text/plain' }), {
      contentType: 'text/plain',
    })
  check('anonymous upload is refused', Boolean(uploadError), uploadError?.message ?? 'ACCEPTED')
}

console.log(
  failures === 0
    ? '\nAll checks passed — the anonymous surface is closed.\n'
    : `\n${String(failures)} check(s) FAILED.\n`,
)
process.exit(failures === 0 ? 0 : 1)
