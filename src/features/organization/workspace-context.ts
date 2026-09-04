import { createContext } from 'react'
import type { PermissionSet } from '@/lib/permissions'
import type { CurrentMembership, OrganizationSummary } from '@/services/organization.service'

export type WorkspaceStatus = 'loading' | 'ready' | 'no-organization' | 'error'

export interface WorkspaceContextValue {
  status: WorkspaceStatus
  organization: OrganizationSummary | null
  organizations: OrganizationSummary[]
  membership: CurrentMembership | null
  /** Resolved server-side; the UI mirrors it, RLS enforces it. */
  permissions: PermissionSet
  error: unknown
  selectOrganization: (organizationId: string) => void
  refresh: () => Promise<void>
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
