import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { labelService, type Label, type LabelInput } from '@/services/label.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'

/**
 * A project's labels, and the writes that change them.
 *
 * The catalogue is its own query family. Putting a label on a task changes the
 * board — a card draws its labels — so that invalidates the tasks; editing the
 * catalogue itself does not touch the board's rows, only the names it draws
 * them with, so both are invalidated together there.
 */
export function useLabels(
  organizationId: string | undefined,
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.projects.labels(organizationId ?? 'none', projectId ?? 'none'),
    queryFn: (): Promise<Label[]> => labelService.list(projectId as string),
    enabled: Boolean(organizationId) && Boolean(projectId) && enabled,
    staleTime: 60_000,
  })
}

export function useLabelMutations(
  organizationId: string | undefined,
  projectId: string | undefined,
) {
  const queryClient = useQueryClient()
  const labels = queryKeys.projects.labels(organizationId ?? 'none', projectId ?? 'none')
  const tasks = queryKeys.projects.tasks(organizationId ?? 'none', projectId ?? 'none')

  const complain = (error: unknown) => {
    toast.error(errorMessage(error))
  }

  const create = useMutation({
    mutationFn: (input: LabelInput) => labelService.create(projectId as string, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: labels })
    },
  })

  const update = useMutation({
    mutationFn: ({ labelId, input }: { labelId: string; input: LabelInput }) =>
      labelService.update(labelId, input),
    onSuccess: async () => {
      // The board draws label names, so it is stale too.
      await queryClient.invalidateQueries({ queryKey: labels })
      await queryClient.invalidateQueries({ queryKey: tasks })
    },
  })

  const remove = useMutation({
    mutationFn: (labelId: string) => labelService.remove(labelId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: labels })
      await queryClient.invalidateQueries({ queryKey: tasks })
    },
    onError: complain,
  })

  const assign = useMutation({
    mutationFn: ({ taskId, labelId }: { taskId: string; labelId: string }) =>
      labelService.assign(taskId, labelId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tasks })
    },
    onError: complain,
  })

  const unassign = useMutation({
    mutationFn: ({ taskId, labelId }: { taskId: string; labelId: string }) =>
      labelService.unassign(taskId, labelId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tasks })
    },
    onError: complain,
  })

  return { create, update, remove, assign, unassign }
}
