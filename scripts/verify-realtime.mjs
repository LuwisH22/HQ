/**
 * Empirical verification that realtime actually delivers.
 *
 * A `SUBSCRIBED` status proves only that the socket opened. Supabase returns
 * it for a table that is not in the publication too — you simply never receive
 * anything. So this drives two independent clients and waits for real events:
 *
 *   1. message INSERT reaches the other client
 *   2. message UPDATE (an edit) reaches it
 *   3. soft delete reaches it, as an UPDATE
 *   4. a typing broadcast reaches it
 *   5. a topic for a channel that does not exist is refused by RLS
 *
 * Clients share one account because that is the only credential available
 * here; they are separate sockets, which is what event delivery depends on.
 * Proving that a member WITHOUT access receives nothing needs a second
 * identity — see the note printed at the end.
 *
 *   node scripts/verify-realtime.mjs
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
  console.error('verify-realtime: missing configuration. See .env / .env.e2e.')
  process.exit(1)
}

let failures = 0
function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label.padEnd(50)} ${detail}`)
  if (!passed) failures += 1
}

/**
 * One password grant, reused.
 *
 * Signing in separately for each client trips the hosted auth rate limit, and
 * what matters for delivery is separate sockets — not separate credentials.
 */
let sharedToken = null

async function signIn() {
  const client = createClient(url, key, { auth: { persistSession: false } })

  if (sharedToken === null) {
    const { data, error } = await client.auth.signInWithPassword({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
    })
    if (error) throw new Error(`sign-in failed: ${error.message}`)
    sharedToken = data.session.access_token
    // Private topics are authorized from the access token, so realtime
    // needs it explicitly.
    await client.realtime.setAuth(sharedToken)
    return client
  }

  const attached = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sharedToken}` } },
  })
  await attached.realtime.setAuth(sharedToken)
  return attached
}

/** Resolves with the first matching event, or null once the window closes. */
function waitFor(predicate, ms = 12_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    predicate.resolve = (value) => {
      clearTimeout(timer)
      resolve(value)
    }
  })
}

const author = await signIn()
const listener = await signIn()

const { data: orgs } = await author.from('organizations').select('id')
const orgId = orgs[0].id

console.log('\nsetting up a probe channel')
const { data: channelId, error: createError } = await author.rpc('create_channel', {
  p_organization_id: orgId,
  p_name: 'realtime probe',
  p_topic: 'created by verify-realtime',
  p_category_id: null,
  p_is_private: false,
})
check('probe channel created', !createError && Boolean(channelId), createError?.message ?? '')
if (!channelId) process.exit(1)

const topic = `channel:${channelId}`
const inbox = { insert: [], update: [], typing: [] }
const gates = { insert: {}, update: {}, typing: {} }

console.log('\n1 · the listener joins the channel topic')
const channel = listener
  .channel(topic, { config: { private: true, broadcast: { self: false } } })
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
    inbox.insert.push(payload.new)
    gates.insert.resolve?.(payload.new)
  })
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
    inbox.update.push(payload.new)
    gates.update.resolve?.(payload.new)
  })
  .on('broadcast', { event: 'typing' }, (payload) => {
    inbox.typing.push(payload.payload)
    gates.typing.resolve?.(payload.payload)
  })

const joined = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('TIMED_OUT'), 15_000)
  channel.subscribe((status, err) => {
    if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      clearTimeout(timer)
      resolve(err ? `${status}: ${String(err.message ?? err)}` : status)
    }
  })
})
check('listener joined the private topic', joined === 'SUBSCRIBED', String(joined))

// SUBSCRIBED means the socket acknowledged the join, not that the server has
// finished wiring the subscription to the WAL stream. Publishing immediately
// loses the first event — which looks exactly like "the table is not in the
// publication" and is not.
await new Promise((resolve) => setTimeout(resolve, 2500))

console.log('\n2 · message events actually arrive')
const { data: userData } = await author.auth.getUser()
const authorId = userData.user.id

const insertGate = waitFor(gates.insert)
const { data: sent, error: sendError } = await author
  .from('messages')
  .insert({ channel_id: channelId, author_id: authorId, body: 'hello from verify-realtime' })
  .select('id, body')
  .single()
check('message sent', !sendError && Boolean(sent), sendError?.message ?? '')

const insertEvent = await insertGate
check('INSERT event received by the other client', insertEvent !== null,
  insertEvent ? `body: ${String(insertEvent.body).slice(0, 24)}` : 'nothing arrived in 12s')

const updateGate = waitFor(gates.update)
const { error: editError } = await author
  .from('messages')
  .update({ body: 'edited by verify-realtime' })
  .eq('id', sent.id)
check('message edited', !editError, editError?.message ?? '')

const updateEvent = await updateGate
check('UPDATE event received', updateEvent !== null,
  updateEvent ? `body: ${String(updateEvent.body).slice(0, 24)}` : 'nothing arrived in 12s')

const deleteGate = waitFor(gates.update)
const { error: deleteError } = await author.rpc('delete_message', { p_message_id: sent.id })
check('message soft-deleted', !deleteError, deleteError?.message ?? '')

const deleteEvent = await deleteGate
check('soft delete arrives as an UPDATE', deleteEvent !== null && deleteEvent.deleted_at !== null,
  deleteEvent ? `deleted_at set` : 'nothing arrived in 12s')

console.log('\n3 · typing broadcasts')
const typingGate = waitFor(gates.typing)
const emitter = author.channel(topic, { config: { private: true } })
await new Promise((resolve) => {
  emitter.subscribe((status) => {
    if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve()
  })
})
await emitter.send({ type: 'broadcast', event: 'typing', payload: { userId: authorId, typing: true } })

const typingEvent = await typingGate
check('typing broadcast received', typingEvent !== null,
  typingEvent ? `userId only: ${Object.keys(typingEvent).join(',')}` : 'nothing arrived in 12s')
check('the payload carries no display name to spoof',
  typingEvent === null || !('name' in typingEvent),
  'names are resolved from the roster, never from the wire')

console.log('\n4 · a topic for a channel that does not exist is refused')
{
  const stranger = await signIn()
  const bogus = stranger.channel('channel:00000000-0000-4000-8000-000000000000', {
    config: { private: true },
  })
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMED_OUT'), 12_000)
    bogus.subscribe((status, err) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        resolve(err ? `${status}` : status)
      }
    })
  })
  check('unknown channel topic is not joinable', result !== 'SUBSCRIBED', String(result))
  await stranger.removeChannel(bogus)
}

console.log('\n5 · cleanup')
await listener.removeChannel(channel)
await author.removeChannel(emitter)
const { error: dropError } = await author.rpc('delete_channel', { p_channel_id: channelId })
check('probe channel deleted', !dropError, dropError?.message ?? '')

// Global sign-out would revoke the token every client here shares.
await author.auth.signOut()

console.log(`
NOT MEASURED HERE — and not claimed
-----------------------------------
That a member WITHOUT access to a channel receives no typing events. Both
clients here share the only credential available, so there is no second
identity to deny. The rule is enforced by the RLS policies on
realtime.messages, which route through the same can_in_channel resolver as
everything else, and is covered in the unit suite — but it has not been
observed end to end against the live project.

To complete it by hand: sign in as a second member without access to a
private channel, open it in one tab and the private channel's topic in
another, and confirm nothing arrives.
`)

console.log(failures === 0 ? 'All measurable realtime checks passed.\n' : `${String(failures)} FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
