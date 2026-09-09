import { describe, expect, it } from 'vitest'
import { applyMove, columnsOf, neighboursAt, positionBetween } from './board-order'
import type { Task } from '@/services/task.service'

/**
 * Where a task lands.
 *
 * This arithmetic exists twice on purpose — here and in
 * `task_position_between` — because the board has to show an answer before the
 * server gives one. So what these tests are really checking is that the two
 * agree: halfway between neighbours, a thousand past either end, and an order
 * that survives being dragged repeatedly.
 */

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    title: 'Book the practice room',
    description: null,
    status: 'todo',
    priority: 'none',
    assigneeId: null,
    createdBy: 'user-1',
    dueDate: null,
    position: 1000,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    labelIds: [],
    ...overrides,
  }
}

/** Three in a column, a thousand apart, as the routine leaves them. */
function column(status: Task['status'] = 'todo'): Task[] {
  return [
    task({ id: 'a', title: 'A', status, position: 1000 }),
    task({ id: 'b', title: 'B', status, position: 2000 }),
    task({ id: 'c', title: 'C', status, position: 3000 }),
  ]
}

const order = (tasks: readonly Task[], status: Task['status'] = 'todo') =>
  columnsOf(tasks)[status].map((one) => one.id)

describe('the position a task takes', () => {
  it('is a thousand when the column is empty', () => {
    expect(positionBetween(undefined, undefined)).toBe(1000)
  })

  it('is halfway between two neighbours', () => {
    expect(positionBetween(1000, 2000)).toBe(1500)
    expect(positionBetween(1000, 1500)).toBe(1250)
  })

  it('is a step past the end, and a step before the start', () => {
    expect(positionBetween(3000, undefined)).toBe(4000)
    expect(positionBetween(undefined, 1000)).toBe(0)
    // Before the first of a column that has already been dragged to the front.
    expect(positionBetween(undefined, 0)).toBe(-1000)
  })

  it('keeps halving without ever colliding', () => {
    let previous = 1000
    const next = 2000
    for (let i = 0; i < 20; i += 1) {
      const between = positionBetween(previous, next)
      expect(between).toBeGreaterThan(previous)
      expect(between).toBeLessThan(next)
      previous = between
    }
  })
})

describe('the columns of a board', () => {
  it('puts every task in its own, in order', () => {
    const tasks = [
      task({ id: 'x', status: 'done', position: 1000, completedAt: '2026-09-02T00:00:00.000Z' }),
      ...column(),
    ]
    const columns = columnsOf(tasks)
    expect(columns.todo.map((one) => one.id)).toEqual(['a', 'b', 'c'])
    expect(columns.done.map((one) => one.id)).toEqual(['x'])
    expect(columns.backlog).toEqual([])
  })

  it('orders by position, not by the order they arrived in', () => {
    const shuffled = [
      task({ id: 'c', position: 3000 }),
      task({ id: 'a', position: 1000 }),
      task({ id: 'b', position: 2000 }),
    ]
    expect(order(shuffled)).toEqual(['a', 'b', 'c'])
  })

  it('breaks a tie the same way the query does', () => {
    // Two tasks that somehow share a position still have one order rather
    // than a flicker between renders.
    const tied = [
      task({ id: 'b', position: 1000, createdAt: '2026-09-02T00:00:00.000Z' }),
      task({ id: 'a', position: 1000, createdAt: '2026-09-01T00:00:00.000Z' }),
    ]
    expect(order(tied)).toEqual(['a', 'b'])
  })
})

describe('the neighbours of a landing', () => {
  it('names the tasks either side of an index', () => {
    const { before, after } = neighboursAt(column(), 1)
    expect(before?.id).toBe('a')
    expect(after?.id).toBe('b')
  })

  it('leaves the moving task out of its own neighbours', () => {
    // Dropping 'a' where 'b' is: the neighbours are what remains, not what
    // was there a moment ago.
    const { before, after } = neighboursAt(column(), 1, 'a')
    expect(before?.id).toBe('b')
    expect(after?.id).toBe('c')
  })

  it('has no neighbour before the top, and none after the end', () => {
    expect(neighboursAt(column(), 0).before).toBeUndefined()
    expect(neighboursAt(column(), 3).after).toBeUndefined()
  })

  it('clamps an index past either end rather than reading off the array', () => {
    expect(neighboursAt(column(), 99).before?.id).toBe('c')
    expect(neighboursAt(column(), -5).after?.id).toBe('a')
  })
})

describe('moving a task', () => {
  it('reorders inside one column', () => {
    // C to the top: above A, so halfway between nothing and 1000.
    const moved = applyMove(column(), { taskId: 'c', status: 'todo', index: 0 })
    expect(order(moved)).toEqual(['c', 'a', 'b'])
    expect(moved.find((one) => one.id === 'c')?.position).toBe(0)
  })

  it('reorders into the middle of one column', () => {
    const moved = applyMove(column(), { taskId: 'c', status: 'todo', index: 1 })
    expect(order(moved)).toEqual(['a', 'c', 'b'])
    expect(moved.find((one) => one.id === 'c')?.position).toBe(1500)
  })

  it('leaves a column alone when a task is dropped back where it was', () => {
    const moved = applyMove(column(), { taskId: 'b', status: 'todo', index: 1 })
    expect(order(moved)).toEqual(['a', 'b', 'c'])
  })

  it('carries a task into another column', () => {
    const moved = applyMove(column(), { taskId: 'b', status: 'in_progress', index: 0 })
    expect(order(moved, 'todo')).toEqual(['a', 'c'])
    expect(order(moved, 'in_progress')).toEqual(['b'])
    // First in an empty column: the same thousand the routine gives it.
    expect(moved.find((one) => one.id === 'b')?.position).toBe(1000)
  })

  it('drops into the middle of another column', () => {
    const board = [...column(), ...column('review').map((one) => ({ ...one, id: `r-${one.id}` }))]
    const moved = applyMove(board, { taskId: 'a', status: 'review', index: 2 })
    expect(order(moved, 'review')).toEqual(['r-a', 'r-b', 'a', 'r-c'])
    expect(moved.find((one) => one.id === 'a')?.position).toBe(2500)
  })

  it('survives being dragged again and again', () => {
    let board = column()
    for (let i = 0; i < 12; i += 1) {
      board = applyMove(board, { taskId: 'c', status: 'todo', index: 1 })
      board = applyMove(board, { taskId: 'a', status: 'todo', index: 1 })
    }
    // Still three tasks, still one order, no duplicates and nothing lost.
    expect(board).toHaveLength(3)
    expect(new Set(order(board)).size).toBe(3)
  })

  it('stamps a completion on the way into Done, and clears it on the way out', () => {
    const NOW = '2026-09-09T12:00:00.000Z'
    const done = applyMove(column(), { taskId: 'a', status: 'done', index: 0 }, NOW)
    expect(done.find((one) => one.id === 'a')?.completedAt).toBe(NOW)

    const back = applyMove(done, { taskId: 'a', status: 'todo', index: 0 }, NOW)
    expect(back.find((one) => one.id === 'a')?.completedAt).toBeNull()
  })

  it('keeps the completion a task already had when it moves within Done', () => {
    const EARLIER = '2026-09-01T09:00:00.000Z'
    const board = [
      task({ id: 'a', status: 'done', position: 1000, completedAt: EARLIER }),
      task({ id: 'b', status: 'done', position: 2000, completedAt: EARLIER }),
    ]
    const moved = applyMove(board, { taskId: 'a', status: 'done', index: 2 })
    expect(moved.find((one) => one.id === 'a')?.completedAt).toBe(EARLIER)
  })

  it('does nothing at all for a task that is not on the board', () => {
    const board = column()
    expect(applyMove(board, { taskId: 'nope', status: 'done', index: 0 })).toEqual(board)
  })
})
