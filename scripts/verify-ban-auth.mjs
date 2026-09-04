/**
 * Empirical test of what a ban actually does to authentication.
 *
 * This exists because the answer must be measured, not assumed. Supabase
 * access tokens are stateless JWTs, and the claim "banning revokes their
 * session" is the kind of thing that is easy to believe and wrong.
 *
 * What is measured here:
 *
 *   1. Does the moderate-user Edge Function report the auth layer as updated?
 *   2. Is organization data blocked immediately, via RLS?
 *   3. Does GoTrue reject a sign-in attempt for a banned account, and does it
 *      say so distinctly enough to tell a ban from a bad password?
 *
 * What is NOT measured, and why: whether an already-issued refresh token still
 * works. That needs a live session belonging to the banned account, and this
 * script only holds the owner's credentials. The procedure for the remaining
 * half is printed at the end so it can be completed by hand.
 *
 *   node scripts/verify-ban-auth.mjs <email-of-a-member-to-ban>
 *
 * The member is unbanned again before the script exits.
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

const env = { ...readEnvFile('.env'), ...readEnvFile('.env.e2e'), ...process.env }
const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key, E2E_EMAIL, E2E_PASSWORD } = env

const TARGET_EMAIL = process.argv[2]
if (!TARGET_EMAIL) {
  console.error('usage: node scripts/verify-ban-auth.mjs <email-of-a-member-to-ban>')
  process.exit(1)
}
if (!url || !key || !E2E_EMAIL || !E2E_PASSWORD) {
  console.error('verify-ban-auth: missing configuration. See .env / .env.e2e.')
  process.exit(1)
}

let failures = 0
function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
  if (!passed) failures += 1
}

const owner = createClient(url, key, { auth: { persistSession: false } })
const { error: authError } = await owner.auth.signInWithPassword({
  email: E2E_EMAIL,
  password: E2E_PASSWORD,
})
if (authError) {
  console.error('owner sign-in failed:', authError.message)
  process.exit(1)
}

console.log(`\nempirical ban behaviour · target ${TARGET_EMAIL}\n`)

const { data: profiles } = await owner.from('profiles').select('id, email')
const target = (profiles ?? []).find((p) => p.email === TARGET_EMAIL)
if (!target) {
  console.error(`No visible profile for ${TARGET_EMAIL}.`)
  process.exit(1)
}

const { data: members } = await owner.from('organization_members').select('id, user_id, status')
const membership = (members ?? []).find((m) => m.user_id === target.id)
if (!membership) {
  console.error('That profile is not a member of this organization.')
  process.exit(1)
}

// --- control: what a wrong password looks like for a NOT-banned account ----
const anon = createClient(url, key, { auth: { persistSession: false } })
const { error: beforeError } = await anon.auth.signInWithPassword({
  email: TARGET_EMAIL,
  password: 'deliberately-wrong-password-for-a-control',
})
const beforeMessage = beforeError?.message ?? '(signed in!)'
console.log(`  control  sign-in before the ban        -> ${beforeMessage}`)

// --- ban through the Edge Function -----------------------------------------
console.log('\n1 · the moderate-user Edge Function')
const banResponse = await owner.functions.invoke('moderate-user', {
  body: { memberId: membership.id, action: 'ban', reason: 'Empirical auth verification' },
})
check('function accepted the ban', !banResponse.error, banResponse.error ? String(banResponse.error) : '')
check(
  'auth layer reported as updated',
  banResponse.data?.authUpdated === true,
  banResponse.data?.warning ?? `authUpdated=${String(banResponse.data?.authUpdated)}`,
)

// --- organization data --------------------------------------------------
console.log('\n2 · organization access (RLS)')
const { data: afterBan } = await owner
  .from('organization_members')
  .select('status')
  .eq('id', membership.id)
  .maybeSingle()
check('membership recorded as banned', afterBan?.status === 'banned', String(afterBan?.status))

const { data: stillActive } = await owner.rpc('is_effectively_active', {
  p_status: 'banned',
  p_suspended_until: null,
})
check('a banned member is never effectively active', stillActive === false, String(stillActive))

// --- authentication --------------------------------------------------------
console.log('\n3 · authentication')
const { error: afterError } = await anon.auth.signInWithPassword({
  email: TARGET_EMAIL,
  password: 'deliberately-wrong-password-for-a-control',
})
const afterMessage = afterError?.message ?? '(signed in!)'
console.log(`  observed sign-in after the ban        -> ${afterMessage}`)
check('sign-in is still refused', Boolean(afterError), afterMessage)
check(
  'the refusal is distinguishable from a bad password',
  afterMessage !== beforeMessage,
  afterMessage === beforeMessage
    ? 'identical message — cannot prove the ban from the client side'
    : 'message changed after banning',
)

// --- restore ---------------------------------------------------------------
console.log('\n4 · cleanup')
const unbanResponse = await owner.functions.invoke('moderate-user', {
  body: { memberId: membership.id, action: 'unban', reason: 'Verification complete' },
})
check('ban lifted', !unbanResponse.error, unbanResponse.error ? String(unbanResponse.error) : '')

const { data: restored } = await owner
  .from('organization_members')
  .select('status')
  .eq('id', membership.id)
  .maybeSingle()
check('membership restored to active', restored?.status === 'active', String(restored?.status))

await owner.auth.signOut()

console.log(`
NOT MEASURED HERE — and not claimed
-----------------------------------
Whether an access token issued BEFORE the ban keeps working until it expires,
and whether the refresh token is rejected. Proving that needs a live session
belonging to the banned account, which this script does not have.

To complete it by hand:
  1. Sign in as the member in a browser and leave the tab open.
  2. Ban them from another session.
  3. In the open tab, reload: organization data should already be empty.
  4. Wait for the access token to expire (jwt_expiry, currently 3600s) or
     clear it, and confirm the session cannot be refreshed.
`)

console.log(failures === 0 ? 'All measurable checks passed.\n' : `${String(failures)} FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
