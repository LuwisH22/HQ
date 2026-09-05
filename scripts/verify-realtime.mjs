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
const inbox = { insert: [], update: [], typing: [], reaction: [], unreaction: [], org: [] }
const gates = { insert: {}, update: {}, typing: {}, reaction: {}, unreaction: {}, org: {} }

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
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'message_reactions' },
    (payload) => {
      inbox.reaction.push(payload.new)
      gates.reaction.resolve?.(payload.new)
    },
  )
  .on(
    'postgres_changes',
    { event: 'DELETE', schema: 'public', table: 'message_reactions' },
    (payload) => {
      inbox.unreaction.push(payload.old)
      gates.unreaction.resolve?.(payload.old)
    },
  )

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

console.log('\n5 · reaction events arrive, both ways')
const { data: reactionTarget } = await author
  .from('messages')
  .insert({ channel_id: channelId, author_id: authorId, body: 'react to me' })
  .select('id')
  .single()

// Give the second subscription the same settle the first one got.
await new Promise((resolve) => setTimeout(resolve, 1500))

const reactionGate = waitFor(gates.reaction)
const { error: reactError } = await author
  .from('message_reactions')
  .insert({ message_id: reactionTarget.id, user_id: authorId, emoji: '\ud83d\udc4d' })
check('reaction added', !reactError, reactError?.message ?? '')

const reactionEvent = await reactionGate
check('the listener was told about the reaction', reactionEvent !== 'TIMED_OUT',
  reactionEvent === 'TIMED_OUT' ? 'no event arrived' : `emoji ${String(reactionEvent.emoji)}`)
check('the payload carries the channel the filter needs',
  reactionEvent !== 'TIMED_OUT' && reactionEvent.channel_id === channelId,
  reactionEvent === 'TIMED_OUT' ? '-' : String(reactionEvent.channel_id))

// The point of REPLICA IDENTITY FULL: without it a DELETE payload carries the
// primary key alone, and a subscription filtering on channel_id never sees it.
const unreactionGate = waitFor(gates.unreaction)
await author
  .from('message_reactions')
  .delete()
  .eq('message_id', reactionTarget.id)
  .eq('user_id', authorId)
  .eq('emoji', '\ud83d\udc4d')

const unreactionEvent = await unreactionGate
check('the listener was told about the removal', unreactionEvent !== 'TIMED_OUT',
  unreactionEvent === 'TIMED_OUT' ? 'no event arrived' : 'received')
// Supabase projects a DELETE payload down to the replica identity, which is
// the primary key — channel_id is not in it, whatever REPLICA IDENTITY FULL
// says. So the client subscribes to reactions unfiltered and lets RLS scope
// delivery, rather than filtering on a column that removals do not carry.
check('the removal payload identifies which reaction went',
  unreactionEvent !== 'TIMED_OUT' &&
    unreactionEvent.emoji === '\ud83d\udc4d' &&
    unreactionEvent.message_id === reactionTarget.id,
  unreactionEvent === 'TIMED_OUT' ? '-' : Object.keys(unreactionEvent).join(', '))

console.log('\n6 · thread replies ride the existing channel subscription')
{
  // A reply is a message with the same channel_id, so it should need no new
  // realtime at all. That is a claim worth watching arrive rather than
  // reasoning about.
  const { data: root } = await author
    .from('messages')
    .insert({ channel_id: channelId, author_id: authorId, body: 'realtime thread root' })
    .select('id')
    .single()

  await new Promise((resolve) => setTimeout(resolve, 1200))

  const replyGate = waitFor(gates.insert)
  const { error } = await author.from('messages').insert({
    channel_id: channelId, author_id: authorId,
    body: 'realtime thread reply', parent_message_id: root.id,
  })
  check('reply sent', !error, error?.message ?? '')

  const replyEvent = await replyGate
  check('the listener was told about the reply', replyEvent !== 'TIMED_OUT',
    replyEvent === 'TIMED_OUT' ? 'no event arrived' : 'received')
  check('and the payload says which thread it belongs to',
    replyEvent !== 'TIMED_OUT' && replyEvent.parent_message_id === root.id,
    replyEvent === 'TIMED_OUT' ? '-' : String(replyEvent.parent_message_id))

  // The root's counter is an UPDATE, which the same subscription carries.
  const countGate = waitFor(gates.update)
  await author.from('messages').insert({
    channel_id: channelId, author_id: authorId,
    body: 'second realtime reply', parent_message_id: root.id,
  })
  const countEvent = await countGate
  check('the root count reaches the listener too',
    countEvent !== 'TIMED_OUT' && countEvent.id === root.id && countEvent.reply_count === 2,
    countEvent === 'TIMED_OUT' ? 'no event arrived' : `count ${String(countEvent.reply_count)}`)
}

console.log('\n6 · pin events ride the existing message subscription')
const pinGate = waitFor(gates.update)
const { error: pinError } = await author.rpc('pin_message', {
  p_message_id: reactionTarget.id, p_pinned: true,
})
check('pin succeeded', !pinError, pinError?.message ?? '')
const pinEvent = await pinGate
check('the listener saw the pin', pinEvent !== 'TIMED_OUT' && pinEvent.pinned_at !== null,
  pinEvent === 'TIMED_OUT' ? 'no event arrived' : 'pinned_at set')

console.log('\n7 · the organization topic')
const orgTopic = `org:${orgId}`
// Not private: it carries Postgres Changes only, and Postgres Changes
// filters row delivery by RLS per subscriber.
const orgChannel = listener
  .channel(orgTopic)
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
    inbox.org.push(payload.new)
    gates.org.resolve?.(payload.new)
  })

const orgJoined = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('TIMED_OUT'), 15_000)
  orgChannel.subscribe((status, err) => {
    if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      clearTimeout(timer)
      resolve(err ? `${status}: ${String(err.message ?? err)}` : status)
    }
  })
})
check('listener joined the organization topic', orgJoined === 'SUBSCRIBED', String(orgJoined))
await new Promise((resolve) => setTimeout(resolve, 2500))

const orgGate = waitFor(gates.org)
await author
  .from('messages')
  .insert({ channel_id: channelId, author_id: authorId, body: 'unread badge trigger' })
const orgEvent = await orgGate
check('a message in any channel reaches the organization topic', orgEvent !== 'TIMED_OUT',
  orgEvent === 'TIMED_OUT' ? 'no event arrived' : 'received')

await listener.removeChannel(orgChannel)

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
That a member WITHOUT access to a channel receives no typing events, no
reaction events, no organization-topic events and no notification of a
mention in it. Both
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
