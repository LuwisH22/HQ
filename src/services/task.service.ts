import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import type { Task, TaskInput, TaskMove, TaskPatch, TaskService } from './service-contracts'

export type { Task, TaskInput, TaskMove, TaskPatch } from './service-contracts'

/**
 * The work on a project.
 *
 * One query per board rather than one per column: five columns of a six-person
 * organization's tasks is a small read, and splitting it would mean five
 * caches to keep in step for no gain.
 *
 * Every write goes through a SECURITY DEFINER routine. In particular a move
 * sends the neighbours it wants to land between rather than a position, so the
 * order is the server's to decide — a client that sent a number could reorder
 * a board it may not touch.
 */

const COLUMNS =
  'id, project_id, title, description, status, priority, assignee_id, created_by, due_date, position, created_at, updated_at, completed_at'

interface Row {
  id: string
  project_id: string
  title: string
  description: string | null
  status: Task['status']
  priority: Task['priority']
  assignee_id: string | null
  created_by: string | null
  due_date: string | null
  position: number
  created_at: string
  updated_at: string
  completed_at: string | null
  task_labels?: { label_id: string }[] | null
}

function toTask(row: Row): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    createdBy: row.created_by,
    dueDate: row.due_date,
    position: Number(row.position),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    // Embedded rather than a second query: a card draws its labels, and the
    // board is one read either way.
    labelIds: (row.task_labels ?? []).map((one) => one.label_id),
  }
}

export const supabaseTaskService: TaskService = {
  async list(projectId: string): Promise<Task[]> {
    const { data, error } = await getSupabase()
      .from('tasks')
      .select(`${COLUMNS}, task_labels(label_id)`)
      .eq('project_id', projectId)
      // Position first, then two stable tie-breakers, so two tasks that
      // somehow share a position still have one order rather than a flicker.
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

    if (error) throw toAppError(error)
    return ((data ?? []) as Row[]).map(toTask)
  },

  async create(input: TaskInput): Promise<string> {
    const { data, error } = await getSupabase().rpc('create_task', {
      p_project_id: input.projectId,
      p_title: input.title,
      p_description: input.description ?? null,
      p_status: input.status ?? 'todo',
      p_priority: input.priority ?? 'none',
      p_assignee_id: input.assigneeId ?? null,
      p_due_date: input.dueDate ?? null,
    })

    if (error) throw toAppError(error)
    return data
  },

  async update(taskId: string, patch: TaskPatch): Promise<void> {
    const { error } = await getSupabase().rpc('update_task', {
      p_task_id: taskId,
      p_title: patch.title ?? null,
      p_description: patch.description ?? null,
      p_priority: patch.priority ?? null,
      p_due_date: patch.dueDate ?? null,
      // Null already means "leave it alone" for every other column, so taking
      // a date off a task has to say so in its own words.
      p_clear_due_date: 'dueDate' in patch && patch.dueDate === null,
    })

    if (error) throw toAppError(error)
  },

  async move(taskId: string, move: TaskMove): Promise<void> {
    const { error } = await getSupabase().rpc('move_task', {
      p_task_id: taskId,
      p_status: move.status ?? null,
      p_before_id: move.beforeId ?? null,
      p_after_id: move.afterId ?? null,
    })

    if (error) throw toAppError(error)
  },

  async assign(taskId: string, assigneeId: string | null): Promise<void> {
    const { error } = await getSupabase().rpc('assign_task', {
      p_task_id: taskId,
      p_assignee_id: assigneeId,
    })

    if (error) throw toAppError(error)
  },

  async remove(taskId: string): Promise<void> {
    const { error } = await getSupabase().rpc('delete_task', { p_task_id: taskId })
    if (error) throw toAppError(error)
  },
}

/** Demo mode has no projects, so it has no work on them either. */
const DEMO_MESSAGE = 'Projects are not part of demo mode.'

const demoTaskService: TaskService = {
  list: () => Promise.resolve([]),
  create: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  update: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  move: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  assign: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  remove: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
}

function impl(): TaskService {
  return isDemoSessionActive() ? demoTaskService : supabaseTaskService
}

export const taskService: TaskService = {
  list: (projectId) => impl().list(projectId),
  create: (input) => impl().create(input),
  update: (taskId, patch) => impl().update(taskId, patch),
  move: (taskId, move) => impl().move(taskId, move),
  assign: (taskId, assigneeId) => impl().assign(taskId, assigneeId),
  remove: (taskId) => impl().remove(taskId),
}
