import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskStatus } from '@/types/database.types'
import { TASK_STATUSES, TASK_STATUS_LABELS } from './task-status'

/**
 * Dragging a card, without a library.
 *
 * Pointer Events rather than HTML5 drag-and-drop, because HTML5 drag does not
 * fire on touch at all and this board has to work on a phone. One code path
 * covers mouse, pen and finger; the same state also drives a keyboard version,
 * so picking a card up and putting it down is one idea with two ways in.
 *
 * The hook owns where things are and where the card would land. It does not
 * own the tasks: it reports an index, and the board decides what that means.
 */

export interface DragOver {
  status: TaskStatus
  /** Where in that column, counting it without the card being carried. */
  index: number
}

export interface DragState extends DragOver {
  taskId: string
  from: TaskStatus
  /** Where to draw the card being carried. Null while the keyboard has it. */
  pointer: { x: number; y: number } | null
  /** Where in the card it was picked up, so it does not jump to its corner. */
  offset: { x: number; y: number }
  size: { width: number; height: number }
  mode: 'pointer' | 'keyboard'
}

export interface BoardDrag {
  drag: DragState | null
  /** What the last move should say out loud. */
  announcement: string
  registerColumn: (status: TaskStatus) => (element: HTMLElement | null) => void
  registerCard: (taskId: string) => (element: HTMLElement | null) => void
  /** From a pointer down on a card's handle. */
  startPointer: (event: React.PointerEvent, taskId: string, from: TaskStatus) => void
  /** From Space or Enter on the same handle. */
  startKeyboard: (taskId: string, from: TaskStatus) => void
  /** Arrow keys while carrying: columns sideways, places up and down. */
  nudge: (direction: 'up' | 'down' | 'left' | 'right') => void
  commit: () => void
  cancel: () => void
}

export function useBoardDrag({
  countIn,
  indexOf,
  onDrop,
  enabled,
}: {
  /** How many cards are in a column, not counting the one being carried. */
  countIn: (status: TaskStatus) => number
  /** Where a task currently sits in its own column. */
  indexOf: (taskId: string) => number
  onDrop: (move: { taskId: string; status: TaskStatus; index: number }) => void
  enabled: boolean
}): BoardDrag {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const columns = useRef(new Map<TaskStatus, HTMLElement>())
  const cards = useRef(new Map<string, HTMLElement>())
  // Read inside window listeners, which are attached once per drag.
  const latest = useRef<DragState | null>(null)
  latest.current = drag

  const registerColumn = useCallback(
    (status: TaskStatus) => (element: HTMLElement | null) => {
      if (element) columns.current.set(status, element)
      else columns.current.delete(status)
    },
    [],
  )

  const registerCard = useCallback(
    (taskId: string) => (element: HTMLElement | null) => {
      if (element) cards.current.set(taskId, element)
      else cards.current.delete(taskId)
    },
    [],
  )

  const say = useCallback((message: string) => {
    setAnnouncement(message)
  }, [])

  /**
   * Carry the board along when the pointer reaches its edge.
   *
   * Without this, dragging to a column that is off the side of a phone is
   * impossible: the target is not on screen, and the hand holding the card
   * cannot also scroll to it.
   */
  const scrollTowards = useCallback((x: number) => {
    const first = columns.current.get(TASK_STATUSES[0])
    const board = first?.closest('[data-board-scroller]')
    if (!(board instanceof HTMLElement)) return

    const rect = board.getBoundingClientRect()
    const EDGE = 56
    if (x < rect.left + EDGE) board.scrollLeft -= Math.max(4, (rect.left + EDGE - x) / 3)
    else if (x > rect.right - EDGE) board.scrollLeft += Math.max(4, (x - (rect.right - EDGE)) / 3)
  }, [])

  /** Which column and which place the pointer is over. */
  const locate = useCallback((x: number, y: number, taskId: string): DragOver | null => {
    let best: { status: TaskStatus; distance: number } | null = null

    for (const status of TASK_STATUSES) {
      const element = columns.current.get(status)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      // Horizontal distance to the column, so a pointer just outside one still
      // has an obvious answer rather than none.
      const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
      if (!best || distance < best.distance) best = { status, distance }
    }
    if (!best) return null

    const element = columns.current.get(best.status)
    if (!element) return null

    // Count the cards whose middle is above the pointer: that is the index the
    // card would take if it were let go here.
    let index = 0
    for (const card of element.querySelectorAll('[data-task-id]')) {
      const id = card.getAttribute('data-task-id')
      if (id === taskId) continue
      const rect = card.getBoundingClientRect()
      if (y > rect.top + rect.height / 2) index += 1
    }
    return { status: best.status, index }
  }, [])

  const startPointer = useCallback(
    (event: React.PointerEvent, taskId: string, from: TaskStatus) => {
      if (!enabled || event.button !== 0) return
      const card = cards.current.get(taskId)
      if (!card) return
      const rect = card.getBoundingClientRect()

      event.preventDefault()
      const next: DragState = {
        taskId,
        from,
        status: from,
        index: indexOf(taskId),
        pointer: { x: event.clientX, y: event.clientY },
        offset: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        size: { width: rect.width, height: rect.height },
        mode: 'pointer',
      }
      setDrag(next)
      latest.current = next
    },
    [enabled, indexOf],
  )

  const startKeyboard = useCallback(
    (taskId: string, from: TaskStatus) => {
      if (!enabled) return
      const index = indexOf(taskId)
      const next: DragState = {
        taskId,
        from,
        status: from,
        index,
        pointer: null,
        offset: { x: 0, y: 0 },
        size: { width: 0, height: 0 },
        mode: 'keyboard',
      }
      setDrag(next)
      latest.current = next
      say(
        `Picked up. ${TASK_STATUS_LABELS[from]}, ${String(index + 1)} of ${String(countIn(from) + 1)}. Arrow keys to move it, space to drop it, escape to put it back.`,
      )
    },
    [countIn, enabled, indexOf, say],
  )

  const nudge = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      const current = latest.current
      if (!current) return

      let status = current.status
      let index = current.index
      if (direction === 'up') index = Math.max(0, index - 1)
      if (direction === 'down') index = Math.min(countIn(status), index + 1)
      if (direction === 'left' || direction === 'right') {
        const at = TASK_STATUSES.indexOf(status)
        const moved = TASK_STATUSES[direction === 'left' ? at - 1 : at + 1]
        if (!moved) return
        status = moved
        index = Math.min(index, countIn(status))
      }

      const next = { ...current, status, index }
      setDrag(next)
      latest.current = next
      say(`${TASK_STATUS_LABELS[status]}, ${String(index + 1)} of ${String(countIn(status) + 1)}.`)
    },
    [countIn, say],
  )

  const commit = useCallback(() => {
    const current = latest.current
    setDrag(null)
    latest.current = null
    if (!current) return
    if (current.mode === 'keyboard') say(`Dropped in ${TASK_STATUS_LABELS[current.status]}.`)
    onDrop({ taskId: current.taskId, status: current.status, index: current.index })
  }, [onDrop, say])

  const cancel = useCallback(() => {
    const current = latest.current
    setDrag(null)
    latest.current = null
    if (current?.mode === 'keyboard') say('Put back.')
  }, [say])

  // The window listens, not the card: a pointer that leaves the card, the
  // column or the window still has to finish the drag it started.
  useEffect(() => {
    if (!drag || drag.mode !== 'pointer') return

    // A pointer reports far more often than a screen redraws — a high-refresh
    // trackpad several times a frame, and coalesced touch events in bursts —
    // and answering each one means a render and a full set of
    // `getBoundingClientRect` reads against a tree React has just touched,
    // which is the classic way to make a drag feel heavy. One update a frame
    // is all a frame can show.
    let frame = 0
    let at: { x: number; y: number } | null = null

    const onMove = (event: PointerEvent) => {
      at = { x: event.clientX, y: event.clientY }
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const current = latest.current
        const point = at
        if (!current || !point) return
        scrollTowards(point.x)
        const over = locate(point.x, point.y, current.taskId)
        const next: DragState = {
          ...current,
          pointer: point,
          status: over?.status ?? current.status,
          index: over?.index ?? current.index,
        }
        setDrag(next)
        latest.current = next
      })
    }
    const onUp = () => {
      commit()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', onKey)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKey)
    }
  }, [cancel, commit, drag, locate, scrollTowards])

  return {
    drag,
    announcement,
    registerColumn,
    registerCard,
    startPointer,
    startKeyboard,
    nudge,
    commit,
    cancel,
  }
}
