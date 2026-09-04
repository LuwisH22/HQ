/**
 * LFG HQ · invite-user Edge Function
 *
 * Public signup is disabled, so creating an account requires the service-role
 * key. That key must never reach the desktop or web client, which is the whole
 * reason this function exists.
 *
 * The flow is deliberately two-clients-in-one-request:
 *
 *   1. `callerClient` is built from the *caller's* JWT. Calling
 *      `create_invitation` through it means the permission check and the audit
 *      row both attribute to a real person, enforced by Postgres.
 *   2. `adminClient` uses the service-role key and does only one thing: ask
 *      GoTrue to email the invite.
 *
 * If step 1 is rejected, step 2 never runs.
 *
 * Deploy:  supabase functions deploy invite-user
 * Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are
 *          injected by the platform. Set PUBLIC_SITE_URL yourself.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

function corsHeaders(origin: string | null): Record<string, string> {
  // With no allow-list configured (local dev) we echo the origin; in production
  // set ALLOWED_ORIGINS so this stays a closed list.
  const allow =
    ALLOWED_ORIGINS.length === 0 ? (origin ?? '*') : ALLOWED_ORIGINS.includes(origin ?? '') ? origin! : ''

  return {
    'Access-Control-Allow-Origin': allow,
    // `x-application-name` is set on the supabase-js client's `global.headers`,
    // which the library passes to every sub-client including Functions. It is a
    // non-simple header, so the browser preflights it and refuses the request
    // unless it is named here. Declaring it grants no read access and no origin
    // relaxation — it only permits the browser to send it.
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

interface InvitePayload {
  organizationId?: unknown
  email?: unknown
  roleId?: unknown
  expiresInDays?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** 32 bytes of CSPRNG entropy, url-safe. Only the SHA-256 digest is stored. */
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
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

  let payload: InvitePayload
  try {
    payload = (await req.json()) as InvitePayload
  } catch {
    return json({ error: 'Request body must be JSON' }, 400, origin)
  }

  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : ''
  const roleId = typeof payload.roleId === 'string' ? payload.roleId : ''
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const expiresInDays =
    typeof payload.expiresInDays === 'number' && Number.isInteger(payload.expiresInDays)
      ? Math.min(Math.max(payload.expiresInDays, 1), 30)
      : 7

  if (!UUID_RE.test(organizationId)) return json({ error: 'Invalid organizationId' }, 400, origin)
  if (!UUID_RE.test(roleId)) return json({ error: 'Invalid roleId' }, 400, origin)
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ error: 'Invalid email address' }, 400, origin)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('invite-user: missing Supabase environment configuration')
    return json({ error: 'Server is not configured' }, 500, origin)
  }

  // 1 — Act as the caller. Postgres decides whether they may invite at all.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = generateToken()

  const { data: invitation, error: inviteError } = await callerClient.rpc('create_invitation', {
    p_organization_id: organizationId,
    p_email: email,
    p_role_id: roleId,
    p_token: token,
    p_expires_in_days: expiresInDays,
  })

  if (inviteError) {
    // Postgres raises `insufficient_privilege` (42501) for authorization
    // failures and `unique_violation` (23505) for an existing member.
    const status = inviteError.code === '42501' ? 403 : inviteError.code === '23505' ? 409 : 400
    return json({ error: inviteError.message }, status, origin)
  }

  // 2 — Only now, with authorization proven, use the privileged key to send
  //     the email. Nothing user-controlled reaches it except the address.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // The token goes in the real query string, NOT inside the hash route.
  //
  // GoTrue appends its own `#access_token=...` fragment to whatever we hand
  // it. supabase-js reads everything after the FIRST `#`, so a URL shaped
  // `/#/auth/accept-invite?token=...#access_token=...` makes the access token
  // unparseable and no session is ever established — the invite then dead-ends
  // on a page that requires one. Landing on `/?invite_token=...` leaves the
  // fragment to Supabase alone. The app strips the parameter before its first
  // render; see src/features/auth/invite-token.ts.
  const siteUrl = (Deno.env.get('PUBLIC_SITE_URL') ?? 'http://localhost:1420').replace(/\/+$/, '')
  const redirectTo = `${siteUrl}/?invite_token=${encodeURIComponent(token)}`

  const { error: mailError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { organization_id: organizationId, invitation_id: invitation?.id },
  })

  if (mailError) {
    // The invitation row stands; the operator can resend. Surfacing the real
    // reason here is safe because the caller already proved they may invite.
    console.error('invite-user: failed to send invite email', mailError.message)
    return json(
      { error: `Invitation recorded but the email could not be sent: ${mailError.message}` },
      502,
      origin,
    )
  }

  return json({ invitation: { id: invitation?.id, email, expiresAt: invitation?.expires_at } }, 200, origin)
})
