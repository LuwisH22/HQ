import { useCallback, useEffect, useMemo } from 'react'
import { Plus } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import type { Task } from '@/services/task.service'
import type { ProjectMember } from '@/services/project.service'
import type { Label } from '@/services/label.service'
import type { TaskStatus } from '@/types/database.types'
import { cn } from '@/lib/utils'
import { TASK_STATUSES, TASK_STATUS_LABELS } from './task-status'
import { applyMove, columnsOf } from './board-order'
import { TaskCard } from './TaskCard'
import { useBoardDrag } from './use-board-drag'
import type { BoardMove } from './use-tasks'

/**
 * The board.
 *
 * Five columns of one project's work, scrolling sideways when there is not
 * room for all of them — which on a phone is always, and which is better than
 * five columns too narrow to read.
 *
 * While a card is being carried the board renders the arrangement it would
 * have if it were dropped now, so the gap follows the pointer and nothing
 * jumps when it lands. That arrangement is computed by the same arithmetic the
 * mutation uses, which is why the optimistic board and the refetched one
 * agree — and it is derived rather than stored, so there is no second copy of
 * where the card is to fall out of step.
 */
export function KanbanBoard({
  tasks,
  members,
  labels,
  canCreate,
  canMove,
  onMove,
  onOpenTask,
  onNewTask,
}: {
  tasks: Task[]
  members: ProjectMember[]
  /** The project's labels, so a card can draw the ones it carries. */
  labels: Label[]
  canCreate: boolean
  canMove: boolean
  onMove: (move: BoardMove) => void
  onOpenTask: (task: Task) => void
  onNewTask: (status: TaskStatus) => void
}) {
  const real = useMemo(() => columnsOf(tasks), [tasks])

  const countIn = useCallback((status: TaskStatus) => real[status].length, [real])
  const indexOf = useCallback(
    (taskId: string) => {
      const task = tasks.find((one) => one.id === taskId)
      if (!task) return 0
      return real[task.status].findIndex((one) => one.id === taskId)
    },
    [real, tasks],
  )

  const drag = useBoardDrag({
    countIn,
    indexOf,
    enabled: canMove,
    onDrop: (move) => {
      const task = tasks.find((one) => one.id === move.taskId)
      if (!task) return
      // Dropping a card exactly where it started is not a mutation.
      const at = real[task.status].findIndex((one) => one.id === move.taskId)
      if (task.status === move.status && at === move.index) return
      onMove(move)
    },
  })

  const carried = drag.drag
  const shown = useMemo(() => {
    if (!carried) return tasks
    return applyMove(tasks, {
      taskId: carried.taskId,
      status: carried.status,
      index: carried.index,
    })
  }, [carried, tasks])

  const columns = useMemo(() => columnsOf(shown), [shown])
  const byId = useMemo(() => new Map(members.map((member) => [member.memberId, member])), [members])
  const labelsById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels])
  const inTheAir = carried ? tasks.find((one) => one.id === carried.taskId) : undefined

  // The arrow keys, while the keyboard is carrying a card. On the window
  // rather than on the card, because the card is being re-rendered into other
  // columns as the keys move it and focus would have to chase it.
  const { nudge, commit, cancel } = drag
  const keyboard = carried?.mode === 'keyboard'
  useEffect(() => {
    if (!keyboard) return
    const directions: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    }
    const onKey = (event: KeyboardEvent) => {
      const direction = directions[event.key]
      if (direction) {
        event.preventDefault()
        nudge(direction)
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        commit()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [cancel, commit, keyboard, nudge])

  return (
    <div className="relative">
      <p aria-live="polite" className="sr-only">
        {drag.announcement}
      </p>

      <div
        data-board-scroller=""
        className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
        role="list"
        aria-label="Board"
      >
        {TASK_STATUSES.map((status) => (
          <section
            key={status}
            role="listitem"
            aria-label={TASK_STATUS_LABELS[status]}
            // Five share the width where there is room for five, and become a
            // scrolling row where there is not — which on a phone is always.
            // Deliberately not snapping: a snap container drags a programmatic
            // scroll back to the nearest column, which is exactly what the
            // board does to itself while a card is being carried to an edge.
            className="min-w-[200px] flex-1 shrink-0"
          >
            <div className="mb-2 flex items-center gap-2 px-0.5">
              <h3 className="display-eyebrow text-3xs text-muted-foreground">
                {TASK_STATUS_LABELS[status]}
              </h3>
              <span className="text-3xs text-muted-foreground/60 font-mono">
                {columns[status].length}
              </span>
              {canCreate ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground ml-auto size-5"
                  aria-label={`New task in ${TASK_STATUS_LABELS[status]}`}
                  onClick={() => {
                    onNewTask(status)
                  }}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </div>

            <ul
              ref={drag.registerColumn(status)}
              className={cn(
                'min-h-[72px] space-y-1.5 rounded-md p-1 transition-colors duration-[120ms]',
                carried?.status === status ? 'bg-elevated/60' : 'bg-transparent',
              )}
            >
              {columns[status].map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  assignee={task.assigneeId ? byId.get(task.assigneeId) : undefined}
                  labels={task.labelIds.flatMap((id) => labelsById.get(id) ?? [])}
                  cardRef={drag.registerCard(task.id)}
                  dragging={carried?.taskId === task.id}
                  canMove={canMove}
                  onOpen={() => {
                    onOpenTask(task)
                  }}
                  onGrabPointer={(event) => {
                    drag.startPointer(event, task.id, task.status)
                  }}
                  onGrabKeyboard={() => {
                    drag.startKeyboard(task.id, task.status)
                  }}
                />
              ))}

              {columns[status].length === 0 ? (
                <li className="text-3xs text-muted-foreground/50 px-2 py-3 text-center">Nothing</li>
              ) : null}
            </ul>
          </section>
        ))}
      </div>

      {/* The card in the air: fixed, pointer-transparent, and a lift rather
          than a transformation. */}
      {carried?.pointer && inTheAir ? (
        <div
          className="border-border-strong bg-elevated pointer-events-none fixed z-50 rounded-md border px-2.5 py-2 shadow-lg"
          style={{
            left: carried.pointer.x - carried.offset.x,
            top: carried.pointer.y - carried.offset.y,
            width: carried.size.width,
          }}
        >
          <span className="block truncate text-xs leading-snug font-medium">{inTheAir.title}</span>
        </div>
      ) : null}
    </div>
  )
}
