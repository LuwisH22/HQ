import { describe, expect, it } from 'vitest'
import {
  defaultsForNewTask,
  defaultsFromTask,
  taskFormSchema,
  toTaskInput,
  toTaskPatch,
  type TaskFormValues,
} from './task-form'
import { TASK_PRIORITIES, TASK_STATUSES } from './task-status'
import type { Task } from '@/services/task.service'

/**
 * What a person types, checked before it becomes a task.
 *
 * Every rule here is also a CHECK constraint or a routine's refusal in
 * Postgres; these tests are about the message arriving early rather than about
 * the database being protected, which it does for itself.
 */

const PROJECT = 'project-1'

function values(overrides: Partial<TaskFormValues> = {}): TaskFormValues {
  return { ...defaultsForNewTask(), title: 'Book the practice room', ...overrides }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: PROJECT,
    title: 'Book the practice room',
    description: 'Two hours, Thursday.',
    status: 'in_progress',
    priority: 'high',
    assigneeId: 'member-1',
    createdBy: 'user-1',
    dueDate: '2026-10-01',
    position: 2000,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    completedAt: null,
    labelIds: [],
    ...overrides,
  }
}

describe('naming a task', () => {
  it('accepts an ordinary one', () => {
    expect(taskFormSchema.safeParse(values()).success).toBe(true)
  })

  it('will not take one with no title', () => {
    const parsed = taskFormSchema.safeParse(values({ title: '   ' }))
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe('A title is required')
  })

  it('will not take a title or description longer than the column', () => {
    expect(taskFormSchema.safeParse(values({ title: 'x'.repeat(201) })).success).toBe(false)
    expect(taskFormSchema.safeParse(values({ title: 'x'.repeat(200) })).success).toBe(true)
    expect(taskFormSchema.safeParse(values({ description: 'x'.repeat(4001) })).success).toBe(false)
    expect(taskFormSchema.safeParse(values({ description: 'x'.repeat(4000) })).success).toBe(true)
  })

  it('trims what it stores', () => {
    expect(toTaskInput(values({ title: '  Book it  ' }), PROJECT).title).toBe('Book it')
  })
})

describe('the columns and priorities on offer', () => {
  it('are the five and the five the database has', () => {
    expect(TASK_STATUSES).toEqual(['backlog', 'todo', 'in_progress', 'review', 'done'])
    expect(TASK_PRIORITIES).toEqual(['none', 'low', 'medium', 'high', 'urgent'])
  })

  it('accepts every one of them', () => {
    for (const status of TASK_STATUSES) {
      expect(taskFormSchema.safeParse(values({ status })).success).toBe(true)
    }
    for (const priority of TASK_PRIORITIES) {
      expect(taskFormSchema.safeParse(values({ priority })).success).toBe(true)
    }
  })

  it('refuses a column or a priority this product does not have', () => {
    expect(taskFormSchema.safeParse({ ...values(), status: 'blocked' }).success).toBe(false)
    expect(taskFormSchema.safeParse({ ...values(), priority: 'critical' }).success).toBe(false)
  })

  it('opens a new task in Todo with nothing on it', () => {
    const fresh = defaultsForNewTask()
    expect(fresh.status).toBe('todo')
    expect(fresh.priority).toBe('none')
    expect(fresh.assigneeId).toBe('')
    expect(fresh.dueDate).toBe('')
  })

  it('opens in the column the plus was pressed in', () => {
    expect(defaultsForNewTask('review').status).toBe('review')
  })
})

describe('when a task is due', () => {
  it('may have no date at all', () => {
    expect(taskFormSchema.safeParse(values({ dueDate: '' })).success).toBe(true)
    expect(toTaskInput(values({ dueDate: '' }), PROJECT).dueDate).toBeNull()
  })

  it('refuses something that is not a date', () => {
    expect(taskFormSchema.safeParse(values({ dueDate: 'thursday' })).success).toBe(false)
    expect(taskFormSchema.safeParse(values({ dueDate: '01-10-2026' })).success).toBe(false)
  })

  it('carries a real one through untouched', () => {
    expect(toTaskInput(values({ dueDate: '2026-10-01' }), PROJECT).dueDate).toBe('2026-10-01')
  })
})

describe('who a task is on', () => {
  it('is nobody by default, and nobody is null rather than an empty string', () => {
    expect(toTaskInput(values(), PROJECT).assigneeId).toBeNull()
  })

  it('is a membership id when somebody has it', () => {
    expect(toTaskInput(values({ assigneeId: 'member-2' }), PROJECT).assigneeId).toBe('member-2')
  })
})

describe('what the service is given', () => {
  it('reads a task back into its own fields', () => {
    const form = defaultsFromTask(task())
    expect(form.title).toBe('Book the practice room')
    expect(form.status).toBe('in_progress')
    expect(form.priority).toBe('high')
    expect(form.assigneeId).toBe('member-1')
    expect(form.dueDate).toBe('2026-10-01')
  })

  it('reads a bare task as empty fields rather than as nulls', () => {
    const form = defaultsFromTask(task({ description: null, assigneeId: null, dueDate: null }))
    expect(form.description).toBe('')
    expect(form.assigneeId).toBe('')
    expect(form.dueDate).toBe('')
  })

  it('sends properties on a change, and never the column', () => {
    const patch = toTaskPatch(values({ status: 'done', dueDate: '' }))
    expect(patch.title).toBe('Book the practice room')
    expect(patch.dueDate).toBeNull()
    // Status moves through the board's own routine, with the position and the
    // completion decided together.
    expect('status' in patch).toBe(false)
    expect('assigneeId' in patch).toBe(false)
  })
})
