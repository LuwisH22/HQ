import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import type { Label, LabelInput, LabelService } from './service-contracts'

export type { Label, LabelInput } from './service-contracts'

/**
 * A project's labels.
 *
 * Reads go straight at the table under the caller's own JWT, so the policy —
 * `tasks.view` and `projects.view` on the project's organization — is what
 * decides what comes back. Writes go through SECURITY DEFINER routines, which
 * ask for `tasks.manage`: there is no separate label permission, because the
 * catalogue already says that managing tasks means managing what is on them.
 */

const COLUMNS = 'id, project_id, name, description, color, created_by, created_at, updated_at'

interface Row {
  id: string
  project_id: string
  name: string
  description: string | null
  color: Label['color']
  created_by: string | null
  created_at: string
  updated_at: string
}

function toLabel(row: Row): Label {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    color: row.color,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const supabaseLabelService: LabelService = {
  async list(projectId: string): Promise<Label[]> {
    const { data, error } = await getSupabase()
      .from('project_labels')
      .select(COLUMNS)
      .eq('project_id', projectId)
      .order('name', { ascending: true })

    if (error) throw toAppError(error)
    return ((data ?? []) as Row[]).map(toLabel)
  },

  async create(projectId: string, input: LabelInput): Promise<string> {
    const { data, error } = await getSupabase().rpc('create_label', {
      p_project_id: projectId,
      p_name: input.name,
      p_color: input.color ?? 'neutral',
      p_description: input.description ?? null,
    })

    if (error) throw toAppError(error)
    return data
  },

  async update(labelId: string, input: LabelInput): Promise<void> {
    const { error } = await getSupabase().rpc('update_label', {
      p_label_id: labelId,
      p_name: input.name,
      p_color: input.color ?? null,
      p_description: input.description ?? null,
    })

    if (error) throw toAppError(error)
  },

  /** The label goes; every task it was on keeps everything else. */
  async remove(labelId: string): Promise<void> {
    const { error } = await getSupabase().rpc('delete_label', { p_label_id: labelId })
    if (error) throw toAppError(error)
  },

  async assign(taskId: string, labelId: string): Promise<void> {
    const { error } = await getSupabase().rpc('assign_label', {
      p_task_id: taskId,
      p_label_id: labelId,
    })
    if (error) throw toAppError(error)
  },

  async unassign(taskId: string, labelId: string): Promise<void> {
    const { error } = await getSupabase().rpc('remove_label', {
      p_task_id: taskId,
      p_label_id: labelId,
    })
    if (error) throw toAppError(error)
  },
}

/** Demo mode has no projects, so it has no labels either. */
const DEMO_MESSAGE = 'Projects are not part of demo mode.'
const refuse = () => Promise.reject(new AppError('validation', DEMO_MESSAGE))

const demoLabelService: LabelService = {
  list: () => Promise.resolve([]),
  create: refuse,
  update: refuse,
  remove: refuse,
  assign: refuse,
  unassign: refuse,
}

function impl(): LabelService {
  return isDemoSessionActive() ? demoLabelService : supabaseLabelService
}

export const labelService: LabelService = {
  list: (projectId) => impl().list(projectId),
  create: (projectId, input) => impl().create(projectId, input),
  update: (labelId, input) => impl().update(labelId, input),
  remove: (labelId) => impl().remove(labelId),
  assign: (taskId, labelId) => impl().assign(taskId, labelId),
  unassign: (taskId, labelId) => impl().unassign(taskId, labelId),
}
