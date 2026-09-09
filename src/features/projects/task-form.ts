import { z } from 'zod'
import type { Task, TaskInput, TaskPatch } from '@/services/task.service'
import { TASK_PRIORITIES, TASK_STATUSES } from './task-status'

/**
 * What a person types, and what the database is given.
 *
 * Every rule below also holds in Postgres. The lengths are the CHECK
 * constraints from 20250919004600 and the two enumerations are its own, so
 * bypassing this form gains nothing; it exists so the refusal arrives in a
 * sentence rather than as a round trip.
 *
 * The assignee is a membership id, empty for nobody — the same shape the
 * project roster deals in, so the picker has nothing to convert.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const optionalDay = z
  .string()
  .refine((value) => value === '' || DAY_PATTERN.test(value), 'Pick a date or leave it empty')

export const taskFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'A title is required')
    .max(200, 'Keep the title under 200 characters'),
  description: z.string().trim().max(4000, 'Keep the description under 4000 characters'),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  assigneeId: z.string(),
  dueDate: optionalDay,
})

export type TaskFormValues = z.infer<typeof taskFormSchema>

/**
 * The form a new task opens with.
 *
 * Todo, no priority and nobody on it, whichever column the button was pressed
 * in — except that the column itself is a better guess than Todo when there
 * is one, so it is passed in.
 */
export function defaultsForNewTask(status: TaskFormValues['status'] = 'todo'): TaskFormValues {
  return { title: '', description: '', status, priority: 'none', assigneeId: '', dueDate: '' }
}

/** A task, back in the fields it was written in. */
export function defaultsFromTask(task: Task): TaskFormValues {
  return {
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId ?? '',
    dueDate: task.dueDate ?? '',
  }
}

/** The form, as the service takes it for a new task. */
export function toTaskInput(values: TaskFormValues, projectId: string): TaskInput {
  return {
    projectId,
    title: values.title.trim(),
    description: values.description.trim() || null,
    status: values.status,
    priority: values.priority,
    assigneeId: values.assigneeId || null,
    dueDate: values.dueDate || null,
  }
}

/**
 * And as it takes a change.
 *
 * Properties only: status moves through the board's own routine, because a
 * column and a place in that column are one decision and setting them apart
 * is how the two drift.
 */
export function toTaskPatch(values: TaskFormValues): TaskPatch {
  return {
    title: values.title.trim(),
    description: values.description.trim() || null,
    priority: values.priority,
    dueDate: values.dueDate || null,
  }
}
