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

/**
 * Resolves with the first matching event, or null once the window closes.
 *
 * `matches` exists because several things arrive on one subscription: an
 * UPDATE carries a pin, and it also carries a thread counter, and a gate that
 * takes whichever lands first reports on the wrong one — intermittently,
 * which is worse than reporting nothing.
 */
function waitFor(predicate, ms = 12_000, matches = () => true) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    predicate.resolve = (value) => {
      if (!matches(value)) return
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
check('the listener was told about the reaction', reactionEvent !== null,
  reactionEvent ? `emoji ${String(reactionEvent.emoji)}` : 'nothing arrived in 12s')
check('the payload carries the channel the filter needs',
  reactionEvent !== null && reactionEvent.channel_id === channelId,
  reactionEvent ? String(reactionEvent.channel_id) : '-')

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
check('the listener was told about the removal', unreactionEvent !== null,
  unreactionEvent ? 'received' : 'nothing arrived in 12s')
// Supabase projects a DELETE payload down to the replica identity, which is
// the primary key — channel_id is not in it, whatever REPLICA IDENTITY FULL
// says. So the client subscribes to reactions unfiltered and lets RLS scope
// delivery, rather than filtering on a column that removals do not carry.
check('the removal payload identifies which reaction went',
  unreactionEvent !== null &&
    unreactionEvent.emoji === '\ud83d\udc4d' &&
    unreactionEvent.message_id === reactionTarget.id,
  unreactionEvent ? Object.keys(unreactionEvent).join(', ') : '-')

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
  check('the listener was told about the reply', replyEvent !== null,
    replyEvent ? 'received' : 'nothing arrived in 12s')
  check('and the payload says which thread it belongs to',
    replyEvent !== null && replyEvent.parent_message_id === root.id,
    replyEvent ? String(replyEvent.parent_message_id) : '-')

  // The root's counter is an UPDATE, which the same subscription carries.
  // The counter for this root, not whatever else is updating.
  const countGate = waitFor(gates.update, 12_000, (m) => m.id === root.id && m.reply_count === 2)
  await author.from('messages').insert({
    channel_id: channelId, author_id: authorId,
    body: 'second realtime reply', parent_message_id: root.id,
  })
  const countEvent = await countGate
  check('the root count reaches the listener too',
    countEvent !== null && countEvent.id === root.id && countEvent.reply_count === 2,
    countEvent ? `count ${String(countEvent.reply_count)}` : 'nothing arrived in 12s')
}

console.log('\n6 · pin events ride the existing message subscription')
// The pin, not a thread counter still in flight from the section above.
const pinGate = waitFor(gates.update, 12_000, (m) => m.id === reactionTarget.id && m.pinned_at !== null)
const { error: pinError } = await author.rpc('pin_message', {
  p_message_id: reactionTarget.id, p_pinned: true,
})
check('pin succeeded', !pinError, pinError?.message ?? '')
const pinEvent = await pinGate
check('the listener saw the pin', pinEvent !== null && pinEvent.pinned_at !== null,
  pinEvent ? 'pinned_at set' : 'nothing arrived in 12s')

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
check('a message in any channel reaches the organization topic', orgEvent !== null,
  orgEvent ? 'received' : 'nothing arrived in 12s')

await listener.removeChannel(orgChannel)

console.log('\n9 · a message with a file on it')
{
  const BUCKET = 'message-attachments'
  const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )

  const objectPath = `${authorId}/${crypto.randomUUID()}`
  const { error: upError } = await author.storage
    .from(BUCKET)
    .upload(objectPath, PIXEL, { contentType: 'image/png' })
  check('the file is uploaded before the message exists', !upError, upError?.message ?? '')

  const gate = waitFor(gates.insert, 12_000, (m) => m.body === 'realtime attachment probe')
  const { data: carrier } = await author
    .from('messages')
    .insert({ channel_id: channelId, author_id: authorId, body: 'realtime attachment probe' })
    .select('id')
    .single()
  await author.from('message_attachments').insert({
    message_id: carrier?.id,
    storage_path: objectPath,
    file_name: 'pixel.png',
  })

  const event = await gate
  check('the message arrives on the existing subscription', event !== null,
    event ? 'received' : 'nothing arrived in 12s')

  // The bytes are storage's business. Realtime carries the row, and the row
  // has no column that could hold a file.
  const payload = JSON.stringify(event ?? {})
  check('and carries no file content', !payload.includes('iVBORw0KGgo'),
    `${String(payload.length)} bytes of payload`)
  check('the payload is a message row and nothing more',
    event !== null && !('storage_path' in event) && !('file_name' in event))

  // The metadata is not on the publication, so it is fetched after the event —
  // which is the design rather than a gap: one transport for state, storage
  // for bytes.
  const { data: attached } = await author
    .from('message_attachments')
    .select('id, file_name, mime_type, byte_size')
    .eq('message_id', carrier?.id)
  check('the metadata is there to be fetched', (attached ?? []).length === 1,
    `${String((attached ?? []).length)} rows`)
  check('and says what storage said', attached?.[0]?.mime_type === 'image/png',
    String(attached?.[0]?.mime_type))

  await author.rpc('delete_message', { p_message_id: carrier?.id })
  await author.storage.from(BUCKET).remove([objectPath])
  const { data: left } = await author.storage.from(BUCKET).list(authorId)
  check('and leaves nothing behind',
    !(left ?? []).some((o) => `${authorId}/${o.name}` === objectPath))
}

console.log('\n8 · the direct message topic')
{
  const { data: roster } = await author
    .from('organization_members')
    .select('user_id')
    .neq('user_id', authorId)
  const partner = (roster ?? [])[0]?.user_id

  check('there is somebody to open a conversation with', Boolean(partner),
    partner ? '' : 'ADD A SECOND MEMBER')

  if (partner) {
    const { data: conversationId, error: convError } = await author.rpc('start_direct_message', {
      p_organization_id: orgId, p_user_id: partner,
    })
    check('conversation opened', !convError && Boolean(conversationId), convError?.message ?? '')

    const dmInbox = { insert: [], typing: [] }
    const dmGates = { insert: {}, typing: {} }

    // Its own socket, deliberately. The listener above has been open since
    // the start of this run with several private topics and a few hundred
    // postgres_changes on it, and in that state Realtime refuses it a NEW
    // private topic with "Unauthorized" while returning true for the very
    // same authorization function over REST, and while a socket opened a
    // second earlier joins the identical topic without complaint. That is a
    // property of a worn-out connection, not of the policy — see the closing
    // note — and measuring the policy through it would measure the wrong
    // thing.
    const dmListener = await signIn()

    // The private topic the C3 Step 1 probe established, in production: the
    // policy calls can_join_conversation_topic, which defers to
    // can_in_conversation.
    const dm = dmListener
      .channel(`dm:${conversationId}`, { config: { private: true, broadcast: { self: false } } })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          dmInbox.insert.push(payload.new)
          dmGates.insert.resolve?.(payload.new)
        },
      )
      .on('broadcast', { event: 'typing' }, (payload) => {
        dmInbox.typing.push(payload.payload)
        dmGates.typing.resolve?.(payload.payload)
      })

    const dmJoined = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('TIMED_OUT'), 15_000)
      dm.subscribe((status, err) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer)
          resolve(err ? `${status}: ${String(err.message ?? err)}` : status)
        }
      })
    })
    check('a member joins the private dm topic', dmJoined === 'SUBSCRIBED', String(dmJoined))

    await new Promise((resolve) => setTimeout(resolve, 2500))

    const dmGate = waitFor(dmGates.insert)
    const { data: dmMessage } = await author
      .from('messages')
      .insert({
        conversation_id: conversationId, author_id: authorId,
        body: 'verify-realtime direct probe',
      })
      .select('id')
      .single()

    const dmEvent = await dmGate
    check('a direct message arrives on it', dmEvent !== null,
      dmEvent ? 'received' : 'nothing arrived in 12s')
    check('and it is the one that was sent', dmEvent?.id === dmMessage?.id)
    check('carrying no channel', dmEvent !== null && dmEvent.channel_id === null,
      String(dmEvent?.channel_id))

    const typingGate = waitFor(dmGates.typing)
    const dmEmitter = author.channel(`dm:${conversationId}`, {
      config: { private: true, broadcast: { self: false } },
    })
    await new Promise((resolve) => {
      dmEmitter.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve()
      })
      setTimeout(resolve, 8000)
    })
    await dmEmitter.send({
      type: 'broadcast', event: 'typing', payload: { userId: authorId, typing: true },
    })
    const typed = await typingGate
    check('typing rides the same topic', typed !== null,
      typed ? 'received' : 'nothing arrived in 12s')

    await author.removeChannel(dmEmitter)
    await dmListener.removeChannel(dm)

    // --- a conversation nobody is in ---------------------------------------
    const stranger = await signIn()
    const bogus = stranger.channel('dm:00000000-0000-4000-8000-000000000000', {
      config: { private: true },
    })
    const refused = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('TIMED_OUT'), 12_000)
      bogus.subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer)
          resolve(status)
        }
      })
    })
    // Membership is the whole rule, so a conversation that does not exist has
    // nobody in it and is not joinable by anyone.
    check('an unknown dm topic is not joinable', refused !== 'SUBSCRIBED', String(refused))
    await stranger.removeChannel(bogus)

    if (dmMessage?.id) {
      await author.rpc('delete_message', { p_message_id: dmMessage.id })
    }
    const { data: left } = await author
      .from('messages').select('id').eq('conversation_id', conversationId)
    check('the probe leaves no direct messages behind', (left ?? []).length === 0,
      `${String((left ?? []).length)} left`)
  }
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

OBSERVED, and worth knowing
---------------------------
A socket that has been open for a while with several private topics and a
few hundred postgres_changes on it can be refused a NEW private topic with
"Unauthorized: You do not have permissions to read from this Channel topic",
while can_join_conversation_topic returns true for that exact topic over
REST for the same session, and while a socket opened one second later joins
it without complaint. It reproduces only through this script's long-lived
listener; a fresh socket, a socket that opened before the conversation
existed, one that had already joined and left other topics, and the
sequence the application itself performs (organization topic held open, a
channel topic opened and closed, then a dm topic) were each tried and all
joined. Section 8 therefore uses its own connection.

This is the same shape as the failure C2 saw on its org: topic and that the
C3 Step 1 probe recorded as transient. It is not transient: it is a
property of the connection, and the probe missed it because it opened a
fresh socket. Nothing here depends on it — a direct message also reaches
the client on the organization topic, which is RLS-filtered per subscriber
— but a dm: topic that will not join means no typing indicator, and that is
the symptom to expect if it is ever seen in the wild.
`)

console.log(failures === 0 ? 'All measurable realtime checks passed.\n' : `${String(failures)} FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
