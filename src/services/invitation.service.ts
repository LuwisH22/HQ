import { getSupabase } from '@/lib/supabase'
import { getEnv } from '@/lib/env'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { demoInvitationService } from '@/services/demo'
import type { CreateInvitationInput, Invitation, InvitationService } from './service-contracts'
import { firstOf } from './postgrest'

/**
 * Invitations.
 *
 * Issuing one needs the service-role key to create the auth user, so the write
 * path goes through the `invite-user` Edge Function rather than PostgREST. The
 * function re-checks the caller's `members.invite` permission inside Postgres,
 * so this client code is a convenience wrapper, not a gate.
 */

export type { CreateInvitationInput, Invitation } from './service-contracts'

interface InviteFunctionError {
  error?: string
}

export const supabaseInvitationService: InvitationService = {
  async list(organizationId: string): Promise<Invitation[]> {
    const { data, error } = await getSupabase()
      .from('invitations')
      .select(
        `id, email, status, expires_at, created_at, role_id,
         role:roles!invitations_role_id_fkey ( id, name ),
         inviter:profiles!invitations_invited_by_fkey ( id, display_name, full_name, email )`,
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })

    if (error) throw toAppError(error)

    return (data ?? []).map((row) => {
      const role = firstOf(row.role)
      const inviter = firstOf(row.inviter)
      return {
        id: row.id,
        email: row.email,
        status: row.status,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        roleId: row.role_id,
        roleName: role?.name ?? 'Unknown role',
        invitedByName: inviter?.display_name ?? inviter?.full_name ?? inviter?.email ?? null,
      }
    })
  },

  /**
   * Invokes the Edge Function with the caller's session attached, so Postgres
   * can attribute both the permission check and the audit entry to a person.
   */
  async create(input: CreateInvitationInput): Promise<{ id: string; email: string }> {
    const supabase = getSupabase()

    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session) {
      throw new AppError('auth', 'Your session has expired. Please sign in again.')
    }

    const response = await supabase.functions.invoke<{
      invitation?: { id: string; email: string }
    }>('invite-user', {
      body: {
        organizationId: input.organizationId,
        email: input.email.trim().toLowerCase(),
        roleId: input.roleId,
        ...(input.expiresInDays ? { expiresInDays: input.expiresInDays } : {}),
      },
    })

    const data = response.data
    // supabase-js types this branch loosely; keep it `unknown` so nothing is
    // read off it without a check.
    const error: unknown = response.error

    if (error) {
      // FunctionsHttpError carries the response; read our JSON error out of it
      // so the user sees "already a member" rather than "non-2xx status code".
      const context: unknown =
        typeof error === 'object' && error !== null && 'context' in error
          ? error.context
          : undefined
      if (context instanceof Response) {
        try {
          const body = (await context.clone().json()) as InviteFunctionError
          if (body.error) {
            const kind = context.status === 403 ? 'forbidden' : 'validation'
            throw new AppError(kind, body.error, { cause: error })
          }
        } catch (parseError) {
          if (parseError instanceof AppError) throw parseError
        }
      }
      throw toAppError(error)
    }

    if (!data?.invitation) {
      throw new AppError('server', 'The invitation could not be created.')
    }
    return data.invitation
  },

  async revoke(invitationId: string): Promise<void> {
    const { error } = await getSupabase().rpc('revoke_invitation', {
      p_invitation_id: invitationId,
    })
    if (error) throw toAppError(error)
  },

  /** Removes a spent invitation row. Pending ones must be revoked first. */
  async deleteSpent(invitationId: string): Promise<void> {
    const { error } = await getSupabase().from('invitations').delete().eq('id', invitationId)
    if (error) throw toAppError(error)
  },
}

/** Dispatches to the demo store when a demo session is active. */
function impl(): InvitationService {
  return isDemoSessionActive() ? demoInvitationService : supabaseInvitationService
}

export const invitationService: InvitationService = {
  list: (organizationId) => impl().list(organizationId),
  create: (input) => impl().create(input),
  revoke: (invitationId) => impl().revoke(invitationId),
  deleteSpent: (invitationId) => impl().deleteSpent(invitationId),
}

/** The link the invited person follows, used for manual resends. */
export function invitationAcceptUrl(token: string): string {
  return `${getEnv().VITE_PUBLIC_SITE_URL}/#/auth/accept-invite?token=${encodeURIComponent(token)}`
}
