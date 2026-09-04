/**
 * LFG HQ · moderate-user Edge Function
 *
 * Banning has two halves, and only one of them can be done from the client:
 *
 *   1. Organization access. `ban_member()` in Postgres records the reason, the
 *      actor and the history, and every authorization helper stops resolving
 *      the member as active. This takes effect immediately and is enforced by
 *      RLS, not by the interface.
 *
 *   2. Authentication. Blocking someone from obtaining a *new* token requires
 *      GoTrue's admin API, which needs the service-role key. That key must
 *      never reach the desktop or web client, which is why this function
 *      exists.
 *
 * Same two-client shape as invite-user:
 *
 *   * `callerClient` carries the caller's JWT, so Postgres decides whether
 *     they may moderate this person at all — permission, hierarchy, ownership,
 *     self-moderation and cross-organization checks all run there.
 *   * `adminClient` uses the service-role key and does exactly one thing: set
 *     or clear `ban_duration` on the target's auth user.
 *
 * If step 1 is rejected, step 2 never runs.
 *
 * KNOWN LIMITATION — documented rather than papered over. Supabase access
 * tokens are stateless JWTs. `ban_duration` stops new sign-ins and token
 * refreshes, but it cannot invalidate an access token that has already been
 * issued; that token stays cryptographically valid until it expires. During
 * that window the person is still *authenticated*, but RLS returns them no
 * organization data at all. There is no admin API in this architecture to
 * revoke an already-issued JWT: `auth.admin.signOut()` takes the target's own
 * JWT, which a server does not have.
 *
 * Deploy:  supabase functions deploy moderate-user
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

/** ~100 years. GoTrue takes a Go duration string; there is no "forever". */
const PERMANENT = '876000h'

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
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Payload {
  memberId?: unknown
  action?: unknown
  reason?: unknown
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

  const memberId = typeof payload.memberId === 'string' ? payload.memberId : ''
  const action = payload.action === 'ban' || payload.action === 'unban' ? payload.action : ''
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''

  if (!UUID_RE.test(memberId)) return json({ error: 'Invalid memberId' }, 400, origin)
  if (!action) return json({ error: 'action must be "ban" or "unban"' }, 400, origin)
  if (action === 'ban' && reason.length === 0) {
    return json({ error: 'A reason is required to ban a member' }, 400, origin)
  }
  if (reason.length > 500) {
    return json({ error: 'Keep the reason under 500 characters' }, 400, origin)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('moderate-user: missing Supabase environment configuration')
    return json({ error: 'Server is not configured' }, 500, origin)
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolve the auth user behind the membership *before* the state changes:
  // once banned, RLS may stop the caller seeing the row at all.
  const { data: member, error: lookupError } = await callerClient
    .from('organization_members')
    .select('user_id')
    .eq('id', memberId)
    .maybeSingle()

  if (lookupError || !member?.user_id) {
    return json({ error: 'Member not found' }, 404, origin)
  }
  const targetUserId = member.user_id as string

  // 1 — Postgres decides. Permission, hierarchy, ownership, self-moderation
  //     and cross-organization checks all live in these routines.
  const { error: rpcError } = await callerClient.rpc(
    action === 'ban' ? 'ban_member' : 'unban_member',
    action === 'ban'
      ? { p_member_id: memberId, p_reason: reason }
      : { p_member_id: memberId, p_reason: reason === '' ? null : reason },
  )

  if (rpcError) {
    const status = rpcError.code === '42501' ? 403 : rpcError.code === 'P0002' ? 404 : 400
    return json({ error: rpcError.message }, status, origin)
  }

  // 2 — Only now, with authorization proven and the decision recorded, use the
  //     privileged key. Nothing user-controlled reaches it but the target id.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: authError } = await adminClient.auth.admin.updateUserById(targetUserId, {
    ban_duration: action === 'ban' ? PERMANENT : 'none',
  })

  if (authError) {
    // Organization access has already been revoked by RLS, so this is a
    // partial success, not a failure. Say so precisely rather than implying
    // the ban did not happen.
    console.error('moderate-user: auth update failed', authError.message)
    return json(
      {
        ok: true,
        authUpdated: false,
        warning:
          `Organization access was ${action === 'ban' ? 'revoked' : 'restored'}, but the ` +
          `authentication layer could not be updated: ${authError.message}`,
      },
      207,
      origin,
    )
  }

  return json({ ok: true, authUpdated: true, action }, 200, origin)
})
