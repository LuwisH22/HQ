/**
 * LFG HQ · voice-token Edge Function
 *
 * A LiveKit access token is a signed statement that the bearer may be in a
 * particular room. The key that signs it can mint a token for any room, with
 * any grant, for any identity — so it exists in exactly one place that is not
 * the client, and that is here.
 *
 * The flow, in order, and every step is a refusal point:
 *
 *   1. A bearer token must be present and must resolve to a real user.
 *      `auth.getUser()` verifies the JWT against the project; a forged or
 *      expired one gets 401 and never reaches step 2.
 *   2. Postgres decides. `voice_room_for()` runs under the caller's own JWT —
 *      not the service-role key — and answers one question: may this person
 *      be in this voice channel, and what is the room called. That routine
 *      inherits can_in_channel_for(..., 'channels.view') whole, so
 *      organization membership, the effective-active gate that excludes
 *      suspended and banned members, ownership from organizations.owner_id,
 *      DENY > ALLOW > INHERIT, and the private-channel allow-list all apply
 *      without being restated here. A channel from another organization fails
 *      the same check, because membership is resolved against the channel's
 *      own organization.
 *   3. Only then is the signing key touched.
 *
 * The client sends a channel id and nothing else. The room name is derived in
 * Postgres from two uuids the database issued, so there is no room a caller
 * can name — not by asking for one, and not by guessing an id, because an id
 * they may not use is refused with the same sentence as an id that does not
 * exist.
 *
 * The grant is the smallest one that carries a conversation: join this one
 * room, publish a microphone, subscribe. No room administration, no
 * participant administration, no data channel, no camera, no screen share —
 * `canPublishSources: ['microphone']` is what makes the last two true rather
 * than merely unused by the current client.
 *
 * TTL is ten minutes. A token is fetched fresh on every connect, so the
 * window in which a leaked one is worth anything is about as long as it takes
 * to use it; long calls do not depend on it, because LiveKit pushes refreshed
 * tokens down the signal channel and livekit-client keeps them for
 * reconnection.
 *
 * Secrets — set with `supabase secrets set`, never in .env with a VITE_ prefix:
 *   LIVEKIT_URL         wss://<project>.livekit.cloud
 *   LIVEKIT_API_KEY
 *   LIVEKIT_API_SECRET
 *
 * Deploy:  supabase functions deploy voice-token
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AccessToken, TrackSource } from 'npm:livekit-server-sdk@2.18.0'

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

/**
 * Ten minutes.
 *
 * Long enough to cover a click, a permission prompt, a device chooser and a
 * couple of retries. Short enough that a token captured from a log or a
 * proxy is worthless before anyone reads it. It is not the length of a call:
 * the server refreshes a connected participant's token on its own.
 */
const TOKEN_TTL_SECONDS = 600

function corsHeaders(origin: string | null): Record<string, string> {
  const allow =
    ALLOWED_ORIGINS.length === 0
      ? (origin ?? '*')
      : ALLOWED_ORIGINS.includes(origin ?? '')
        ? origin!
        : ''

  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-application-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      // A token is a credential. Nothing between here and the tab should keep
      // a copy of it.
      'Cache-Control': 'no-store',
    },
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Payload {
  channelId?: unknown
}

interface VoiceRoom {
  room_name: string
  channel_id: string
  channel_name: string
  organization_id: string
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing bearer token' }, 401, origin)
  }

  let payload: Payload
  try {
    payload = (await req.json()) as Payload
  } catch {
    return json({ error: 'Request body must be JSON' }, 400, origin)
  }

  const channelId = typeof payload.channelId === 'string' ? payload.channelId : ''
  // A channel id is a uuid or it is not a channel id. Nothing else reaches
  // Postgres, and nothing at all reaches LiveKit.
  if (!UUID_RE.test(channelId)) {
    return json({ error: 'Invalid channelId' }, 400, origin)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    console.error('voice-token: missing Supabase environment configuration')
    return json({ error: 'Server is not configured' }, 500, origin)
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1 — Who is this. A bearer token that does not resolve to a user gets no
  //     further; the answer is the same whatever channel was asked for.
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  const user = userData?.user
  if (userError || !user) {
    return json({ error: 'Not signed in' }, 401, origin)
  }

  // 2 — Postgres decides. Under the caller's own JWT, so every rule that
  //     governs the channel governs this, and none of them is restated here.
  const { data: rooms, error: roomError } = await callerClient.rpc('voice_room_for', {
    p_channel_id: channelId,
  })

  if (roomError) {
    const status = roomError.code === '42501' ? 403 : 400
    return json({ error: roomError.message }, status, origin)
  }

  const room = (rooms as VoiceRoom[] | null)?.[0]
  if (!room?.room_name) {
    return json({ error: 'You do not have access to that voice channel' }, 403, origin)
  }

  // 3 — Authorization is settled. Only now does the signing key exist in this
  //     request at all.
  const livekitUrl = Deno.env.get('LIVEKIT_URL')
  const apiKey = Deno.env.get('LIVEKIT_API_KEY')
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET')
  if (!livekitUrl || !apiKey || !apiSecret) {
    // Said plainly rather than as a 500: the deployment is incomplete, the
    // request was fine, and the client can tell the difference.
    console.error('voice-token: LiveKit is not configured')
    return json({ error: 'Voice is not configured for this workspace' }, 503, origin)
  }

  // A display name only. It is what other participants see; it grants nothing.
  const { data: profile } = await callerClient
    .from('profiles')
    .select('display_name, full_name, email')
    .eq('id', user.id)
    .maybeSingle()

  const displayName =
    (profile?.display_name as string | null) ??
    (profile?.full_name as string | null) ??
    (profile?.email as string | null) ??
    'Member'

  const accessToken = new AccessToken(apiKey, apiSecret, {
    // The Supabase user id, so a participant in a room is the same person the
    // database knows and two tabs are one identity.
    identity: user.id,
    name: displayName,
    ttl: TOKEN_TTL_SECONDS,
  })

  accessToken.addGrant({
    roomJoin: true,
    // This room. Not a pattern, not a prefix, not a list.
    room: room.room_name,
    canPublish: true,
    canSubscribe: true,
    // Everything below is off on purpose. Voice is step 1; a token that could
    // already carry a camera or a screen would be a decision made by accident.
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
    canUpdateOwnMetadata: false,
    roomCreate: false,
    roomList: false,
    roomAdmin: false,
    roomRecord: false,
    ingressAdmin: false,
    hidden: false,
    recorder: false,
  })

  return json(
    {
      token: await accessToken.toJwt(),
      url: livekitUrl,
      room: room.room_name,
      identity: user.id,
      channelName: room.channel_name,
      expiresInSeconds: TOKEN_TTL_SECONDS,
    },
    200,
    origin,
  )
})
