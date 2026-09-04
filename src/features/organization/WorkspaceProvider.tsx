import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { organizationService } from '@/services/organization.service'
import { PermissionSet } from '@/lib/permissions'
import { queryKeys } from '@/lib/query-keys'
import { useUiStore } from '@/stores/ui.store'
import { useAuth } from '@/hooks/use-auth'
import { WorkspaceContext, type WorkspaceContextValue } from './workspace-context'

/**
 * Resolves which organization is active and what the signed-in member may do
 * inside it.
 *
 * The permission set comes from the database on every load rather than being
 * inferred from a cached role name — a role's permissions can change while a
 * session is open, and stale UI that offers an action the server will reject
 * is worse than no UI at all.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus } = useAuth()
  const queryClient = useQueryClient()
  const activeOrganizationId = useUiStore((state) => state.activeOrganizationId)
  const setActiveOrganization = useUiStore((state) => state.setActiveOrganization)

  const isAuthenticated = authStatus === 'authenticated'

  const organizationsQuery = useQuery({
    queryKey: queryKeys.organizations.mine(),
    queryFn: () => organizationService.listMine(),
    enabled: isAuthenticated,
  })

  const organizations = useMemo(() => organizationsQuery.data ?? [], [organizationsQuery.data])

  // Fall back to the first organization when nothing is stored, or when the
  // stored id refers to somewhere the user no longer belongs.
  const resolvedOrganizationId = useMemo(() => {
    if (organizations.length === 0) return null
    const stored = organizations.find((org) => org.id === activeOrganizationId)
    return stored?.id ?? organizations[0]?.id ?? null
  }, [organizations, activeOrganizationId])

  useEffect(() => {
    if (resolvedOrganizationId && resolvedOrganizationId !== activeOrganizationId) {
      setActiveOrganization(resolvedOrganizationId)
    }
  }, [resolvedOrganizationId, activeOrganizationId, setActiveOrganization])

  const membershipQuery = useQuery({
    queryKey: queryKeys.membership.current(resolvedOrganizationId ?? 'none'),
    queryFn: () => organizationService.getCurrentMembership(resolvedOrganizationId as string),
    enabled: isAuthenticated && Boolean(resolvedOrganizationId),
  })

  const organization = useMemo(
    () => organizations.find((org) => org.id === resolvedOrganizationId) ?? null,
    [organizations, resolvedOrganizationId],
  )

  const selectOrganization = useCallback(
    (organizationId: string) => {
      setActiveOrganization(organizationId)
    },
    [setActiveOrganization],
  )

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.mine() }),
      resolvedOrganizationId
        ? queryClient.invalidateQueries({
            queryKey: queryKeys.membership.current(resolvedOrganizationId),
          })
        : Promise.resolve(),
    ])
  }, [queryClient, resolvedOrganizationId])

  const value = useMemo<WorkspaceContextValue>(() => {
    const status: WorkspaceContextValue['status'] = !isAuthenticated
      ? 'loading'
      : organizationsQuery.isError || membershipQuery.isError
        ? 'error'
        : organizationsQuery.isPending
          ? 'loading'
          : organizations.length === 0
            ? 'no-organization'
            : membershipQuery.isPending
              ? 'loading'
              : membershipQuery.data
                ? 'ready'
                : 'no-organization'

    return {
      status,
      organization,
      organizations,
      membership: membershipQuery.data ?? null,
      permissions: membershipQuery.data?.permissions ?? PermissionSet.empty(),
      error: organizationsQuery.error ?? membershipQuery.error,
      selectOrganization,
      refresh,
    }
  }, [
    isAuthenticated,
    organization,
    organizations,
    organizationsQuery.isError,
    organizationsQuery.isPending,
    organizationsQuery.error,
    membershipQuery.data,
    membershipQuery.isError,
    membershipQuery.isPending,
    membershipQuery.error,
    selectOrganization,
    refresh,
  ])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
