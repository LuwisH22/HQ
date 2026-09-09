import { useQuery } from '@tanstack/react-query'
import { projectService, type Project, type ProjectMember } from '@/services/project.service'
import { queryKeys } from '@/lib/query-keys'

/**
 * The organization's projects, and one project's roster.
 *
 * Server state, in TanStack Query, as everything server-shaped in this
 * application is. Nothing about a project is worth keeping in a store: the
 * list is a query, and which dialog is open is local state where it belongs.
 */
export function useProjects(organizationId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projects.list(organizationId ?? 'none'),
    queryFn: (): Promise<Project[]> => projectService.list(organizationId as string),
    enabled: Boolean(organizationId) && enabled,
    // Projects change on the order of days, not seconds.
    staleTime: 60_000,
  })
}

export function useProject(organizationId: string | undefined, projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.detail(organizationId ?? 'none', projectId ?? 'none'),
    queryFn: (): Promise<Project | null> => projectService.get(projectId as string),
    enabled: Boolean(organizationId) && Boolean(projectId),
    staleTime: 60_000,
  })
}

export function useProjectMembers(
  organizationId: string | undefined,
  projectId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.projects.members(organizationId ?? 'none', projectId ?? 'none'),
    queryFn: (): Promise<ProjectMember[]> => projectService.listMembers(projectId as string),
    enabled: Boolean(organizationId) && Boolean(projectId),
    staleTime: 60_000,
  })
}
