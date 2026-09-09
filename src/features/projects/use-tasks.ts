import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { taskService, type Task, type TaskInput, type TaskPatch } from '@/services/task.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import type { TaskStatus } from '@/types/database.types'
import { applyMove, columnsOf, neighboursAt } from './board-order'

/**
 * One project's board, and the writes that change it.
 *
 * One query for the whole board rather than one per column: five columns of a
 * six-person organization's work is a small read, and splitting it would mean
 * five caches to keep in step for nothing.
 */
export function useTasks(
  organizationId: string | undefined,
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.projects.tasks(organizationId ?? 'none', projectId ?? 'none'),
    queryFn: (): Promise<Task[]> => taskService.list(projectId as string),
    enabled: Boolean(organizationId) && Boolean(projectId) && enabled,
    staleTime: 30_000,
  })
}

export interface BoardMove {
  taskId: string
  status: TaskStatus
  /** Where in that column, counting the column as it will be without the task. */
  index: number
}

/**
 * The board's writes.
 *
 * A move is optimistic and everything else is not, which is the honest split:
 * dragging has to feel like the card went where it was put, while a form that
 * has just been submitted is already telling somebody to wait. The optimistic
 * board is computed by the same arithmetic the routine uses, so what appears
 * immediately and what comes back from the refetch agree.
 *
 * Authorization is never assumed: the server decides, and a refusal puts the
 * board back exactly as it was and says why.
 */
export function useTaskMutations(
  organizationId: string | undefined,
  projectId: string | undefined,
) {
  const queryClient = useQueryClient()
  /**
   * The board's query family, and every board write's mutation key.
   *
   * The same array in both roles on purpose: it lets anything that cares —
   * realtime, in 6.4 — ask whether this board is still waiting on the server,
   * without the board having to tell it.
   */
  const key = queryKeys.projects.tasks(organizationId ?? 'none', projectId ?? 'none')

  /** The project's own key, so a task count on the project reads true. */
  const projectKey = queryKeys.projects.all(organizationId ?? 'none')

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: key })
  }

  const create = useMutation({
    mutationKey: key,
    mutationFn: (input: TaskInput) => taskService.create(input),
    onSuccess: async () => {
      await invalidate()
    },
    onError: (error) => {
      toast.error(errorMessage(error))
    },
  })

  const update = useMutation({
    mutationKey: key,
    mutationFn: ({ taskId, patch }: { taskId: string; patch: TaskPatch }) =>
      taskService.update(taskId, patch),
    onSuccess: async () => {
      await invalidate()
    },
  })

  const assign = useMutation({
    mutationKey: key,
    mutationFn: ({ taskId, assigneeId }: { taskId: string; assigneeId: string | null }) =>
      taskService.assign(taskId, assigneeId),
    onSuccess: async () => {
      await invalidate()
    },
    onError: (error) => {
      toast.error(errorMessage(error))
    },
  })

  const remove = useMutation({
    mutationKey: key,
    mutationFn: (taskId: string) => taskService.remove(taskId),
    onSuccess: async () => {
      await invalidate()
      await queryClient.invalidateQueries({ queryKey: projectKey })
    },
  })

  const move = useMutation({
    mutationKey: key,
    mutationFn: (board: BoardMove) => {
      const tasks = queryClient.getQueryData<Task[]>(key) ?? []
      const { before, after } = neighboursAt(
        columnsOf(tasks)[board.status],
        board.index,
        board.taskId,
      )
      // The neighbours, not a number: the server works out the position, so a
      // board that was a moment out of date still lands the task beside what
      // it was told about.
      return taskService.move(board.taskId, {
        status: board.status,
        beforeId: before?.id ?? null,
        afterId: after?.id ?? null,
      })
    },
    onMutate: async (board: BoardMove) => {
      // A refetch landing mid-drag would undo the card under the pointer.
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Task[]>(key)
      if (previous) queryClient.setQueryData<Task[]>(key, applyMove(previous, board))
      return { previous }
    },
    onError: (error, _board, context) => {
      // Put it back exactly where it was, and say why it did not go.
      if (context?.previous) queryClient.setQueryData<Task[]>(key, context.previous)
      toast.error(errorMessage(error))
    },
    onSettled: async () => {
      // Whatever happened, the server's positions are the real ones.
      await invalidate()
    },
  })

  return { create, update, assign, remove, move }
}
