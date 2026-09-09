import type { Task } from '@/services/task.service'
import type { TaskStatus } from '@/types/database.types'
import { TASK_STATUSES } from './task-status'

/**
 * Where a task sits, worked out the same way in two places.
 *
 * The server decides every real position — a client that sent its own could
 * reorder a board it may not touch — but the board has to show the answer
 * before the round trip returns. So this mirrors `task_position_between` in
 * 20250919004600 exactly: halfway between the neighbours, a thousand past the
 * end, a thousand before the start. The refetch that follows a move is what
 * makes the two agree; this is what makes them agree in the meantime.
 */

/** The gap left between tasks, and the step taken past either end. */
const STEP = 1000

export function positionBetween(previous?: number, next?: number): number {
  if (previous === undefined && next === undefined) return STEP
  if (previous === undefined) return (next as number) - STEP
  if (next === undefined) return previous + STEP
  return (previous + next) / 2
}

/** One board, as five ordered columns. */
export function columnsOf(tasks: readonly Task[]): Record<TaskStatus, Task[]> {
  const columns = Object.fromEntries(
    TASK_STATUSES.map((status) => [status, [] as Task[]]),
  ) as Record<TaskStatus, Task[]>

  for (const task of tasks) columns[task.status].push(task)
  for (const status of TASK_STATUSES) columns[status].sort(byPosition)
  return columns
}

/** Position, then two stable tie-breakers, exactly as the query orders them. */
function byPosition(a: Task, b: Task): number {
  if (a.position !== b.position) return a.position - b.position
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : 1
}

/** The two tasks a landing sits between, given a column and an index. */
export function neighboursAt(
  column: readonly Task[],
  index: number,
  movingId?: string,
): { before?: Task; after?: Task } {
  const without = movingId ? column.filter((task) => task.id !== movingId) : [...column]
  const at = Math.max(0, Math.min(index, without.length))
  return { before: without[at - 1], after: without[at] }
}

/**
 * The board as it will look, before the server has said so.
 *
 * Pure, and the same arithmetic the routine uses, so an optimistic board and
 * the one that comes back from a refetch agree about order. `completedAt`
 * moves with the status for the same reason: the constraint in Postgres does
 * not allow the two to disagree, so neither does this.
 */
export function applyMove(
  tasks: readonly Task[],
  move: { taskId: string; status: TaskStatus; index: number },
  now: string = new Date().toISOString(),
): Task[] {
  const moving = tasks.find((task) => task.id === move.taskId)
  if (!moving) return [...tasks]

  const column = columnsOf(tasks)[move.status]
  const { before, after } = neighboursAt(column, move.index, move.taskId)

  const moved: Task = {
    ...moving,
    status: move.status,
    position: positionBetween(before?.position, after?.position),
    completedAt: move.status === 'done' ? (moving.completedAt ?? now) : null,
  }

  return tasks.map((task) => (task.id === moved.id ? moved : task))
}
