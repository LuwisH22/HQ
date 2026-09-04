import { getSupabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { demoAuditService } from '@/services/demo'
import type { AuditEntry, AuditService } from './service-contracts'
import { firstOf } from './postgrest'

export type { AuditEntry } from './service-contracts'

export const supabaseAuditService: AuditService = {
  /**
   * Recent administrative activity. Visible only to members holding
   * `audit.read` — enforced by RLS, so a caller without it simply gets zero
   * rows rather than an error.
   */
  async listRecent(organizationId: string, limit = 20): Promise<AuditEntry[]> {
    const { data, error } = await getSupabase()
      .from('audit_logs')
      .select(
        `id, action, entity_type, entity_id, summary, created_at,
         actor:profiles!audit_logs_actor_id_fkey ( id, display_name, full_name, avatar_url )`,
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100))

    if (error) throw toAppError(error)

    return (data ?? []).map((row) => {
      const actor = firstOf(row.actor)
      return {
        id: row.id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        createdAt: row.created_at,
        actor: actor
          ? {
              id: actor.id,
              displayName: actor.display_name,
              fullName: actor.full_name,
              avatarUrl: actor.avatar_url,
            }
          : null,
      }
    })
  },
}

/** Dispatches to the demo store when a demo session is active. */
function impl(): AuditService {
  return isDemoSessionActive() ? demoAuditService : supabaseAuditService
}

export const auditService: AuditService = {
  listRecent: (organizationId, limit) => impl().listRecent(organizationId, limit),
}
