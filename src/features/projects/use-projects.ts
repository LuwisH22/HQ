import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  projectService,
  type Project,
  type ProjectMember,
  type ProjectOverview,
  type ProjectTransition,
} from '@/services/project.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'

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

/**
 * Counts and who is working on each project.
 *
 * Its own query rather than part of the list, because the two go stale for
 * different reasons: a project is renamed rarely, and somebody finishes a task
 * all day long. Keeping them apart means a completed task redraws a row of
 * avatars without refetching every project in the organization.
 */
export function useProjectOverview(organizationId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projects.overview(organizationId ?? 'none'),
    queryFn: (): Promise<ProjectOverview[]> => projectService.overview(organizationId as string),
    enabled: Boolean(organizationId) && enabled,
    staleTime: 30_000,
  })
}

/**
 * Everything that moves a project, or puts it away, or ends it.
 *
 * None of it is optimistic. A transition is a rule the database enforces and
 * may well refuse — before a review deadline, with work still open, on an
 * archived project — and a stage that flicked forward and then back would be
 * the screen telling a story the server never agreed to. Each of these waits,
 * then says what happened.
 */
export function useProjectLifecycle(organizationId: string | undefined, projectId: string) {
  const queryClient = useQueryClient()

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.projects.detail(organizationId ?? 'none', projectId),
    })
    await queryClient.invalidateQueries({
      queryKey: queryKeys.projects.list(organizationId ?? 'none'),
    })
  }
  const complain = (error: unknown) => {
    toast.error(errorMessage(error))
  }

  const move = useMutation({
    mutationFn: (transition: ProjectTransition) => projectService.transition(projectId, transition),
    onSuccess: refresh,
    onError: complain,
  })

  const archive = useMutation({
    mutationFn: () => projectService.archive(projectId),
    onSuccess: refresh,
    onError: complain,
  })

  const restore = useMutation({
    mutationFn: () => projectService.restore(projectId),
    onSuccess: refresh,
    onError: complain,
  })

  const remove = useMutation({
    mutationFn: () => projectService.remove(projectId),
    // Nothing to refresh on the detail page: it is about to leave, and the
    // list it returns to is what needs to be told.
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all(organizationId ?? 'none'),
      })
    },
    onError: complain,
  })

  return { move, archive, restore, remove }
}
