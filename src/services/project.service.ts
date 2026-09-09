import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { firstOf } from './postgrest'
import type {
  Project,
  ProjectInput,
  ProjectMember,
  ProjectOverview,
  ProjectPatch,
  ProjectService,
  ProjectTransition,
  ProjectWorker,
} from './service-contracts'

export type {
  Project,
  ProjectInput,
  ProjectMember,
  ProjectOverview,
  ProjectPatch,
  ProjectTransition,
  ProjectWorker,
} from './service-contracts'

/**
 * The organization's projects.
 *
 * Reads go straight at the tables under the caller's own JWT, so the
 * `projects.view` policy is what decides what comes back — a member of another
 * organization gets zero rows rather than an error, and there is no filtering
 * here that a mistake could widen. Writes go through the SECURITY DEFINER
 * routines, as every protected write in this application does: the routine
 * checks the permission, validates the shape and writes the audit entry.
 *
 * Archiving and deleting are both here and are not the same thing: one puts a
 * project away with everything it owns intact, the other takes it and its
 * tasks, labels, comments and roster with it and cannot be undone. The stage a
 * project is at is not writable from here at all — `transition` is the only
 * way it moves, and the routine behind it decides whether the move is legal.
 */

const COLUMNS =
  `id, organization_id, name, description, status, start_date, due_date,
   archived_at, review_started_at, review_deadline_at, review_duration_minutes,
   review_round, created_by, created_at, updated_at`

interface Row {
  id: string
  organization_id: string
  name: string
  description: string | null
  status: Project['status']
  start_date: string | null
  due_date: string | null
  archived_at: string | null
  review_started_at: string | null
  review_deadline_at: string | null
  review_duration_minutes: number | null
  review_round: number
  created_by: string | null
  created_at: string
  updated_at: string
  project_members?: { count: number }[] | { count: number } | null
}

function toProject(row: Row): Project {
  const counted = firstOf(row.project_members)
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    status: row.status,
    startDate: row.start_date,
    dueDate: row.due_date,
    archivedAt: row.archived_at,
    reviewStartedAt: row.review_started_at,
    reviewDeadlineAt: row.review_deadline_at,
    reviewDurationMinutes: row.review_duration_minutes,
    reviewRound: row.review_round,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: counted?.count ?? 0,
  }
}

export const supabaseProjectService: ProjectService = {
  async list(organizationId: string): Promise<Project[]> {
    const { data, error } = await getSupabase()
      .from('projects')
      // The count comes from the database rather than from a second round
      // trip, and is scoped by the roster's own policy.
      .select(`${COLUMNS}, project_members(count)`)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })

    if (error) throw toAppError(error)
    return ((data ?? []) as unknown as Row[]).map(toProject)
  },

  async get(projectId: string): Promise<Project | null> {
    const { data, error } = await getSupabase()
      .from('projects')
      .select(`${COLUMNS}, project_members(count)`)
      .eq('id', projectId)
      .maybeSingle()

    if (error) throw toAppError(error)
    return data ? toProject(data) : null
  },

  async create(input: ProjectInput): Promise<string> {
    const { data, error } = await getSupabase().rpc('create_project', {
      p_organization_id: input.organizationId,
      p_name: input.name,
      p_description: input.description ?? null,
      p_status: input.status ?? 'planned',
      p_start_date: input.startDate ?? null,
      p_due_date: input.dueDate ?? null,
    })

    if (error) throw toAppError(error)
    return data
  },

  /**
   * A partial update. Anything left out is left alone — including the
   * organization, which is not a parameter at all: a project cannot change
   * hands, and the database refuses it even if something tried.
   */
  async update(projectId: string, input: ProjectPatch): Promise<void> {
    const { error } = await getSupabase().rpc('update_project', {
      p_project_id: projectId,
      p_name: input.name ?? null,
      p_description: input.description ?? null,
      p_start_date: input.startDate ?? null,
      p_due_date: input.dueDate ?? null,
      // Null already means "leave it alone" for every other column, so taking
      // a date off a project has to say so in its own words.
      p_clear_start_date: 'startDate' in input && input.startDate === null,
      p_clear_due_date: 'dueDate' in input && input.dueDate === null,
    })

    if (error) throw toAppError(error)
  },

  /**
   * The one way a project changes stage.
   *
   * Nothing is sent but the target and, for a review, how long it should run.
   * The deadline itself is made by the routine from the server's clock — a
   * timestamp from here would be a deadline the person racing it could choose.
   */
  async transition(projectId: string, move: ProjectTransition): Promise<void> {
    const { error } = await getSupabase().rpc('transition_project', {
      p_project_id: projectId,
      p_target: move.target,
      p_review_duration_minutes: move.reviewDurationMinutes ?? null,
      p_allow_unfinished: move.allowUnfinished ?? false,
    })

    if (error) throw toAppError(error)
  },

  async archive(projectId: string): Promise<void> {
    const { error } = await getSupabase().rpc('archive_project', { p_project_id: projectId })
    if (error) throw toAppError(error)
  },

  async restore(projectId: string): Promise<void> {
    const { error } = await getSupabase().rpc('restore_project', { p_project_id: projectId })
    if (error) throw toAppError(error)
  },

  /** Permanent. Everything that references the project goes with it. */
  async remove(projectId: string): Promise<void> {
    const { error } = await getSupabase().rpc('delete_project', { p_project_id: projectId })
    if (error) throw toAppError(error)
  },

  /**
   * Counts and who is working on each project, in one round trip.
   *
   * A routine rather than a query, because "who is working on it" is a
   * question about tasks, and asking it per project from here would be one
   * request per row.
   */
  async overview(organizationId: string): Promise<ProjectOverview[]> {
    const { data, error } = await getSupabase().rpc('project_overview', {
      p_organization_id: organizationId,
    })

    if (error) throw toAppError(error)
    return (data ?? []).map((row) => ({
      projectId: row.project_id,
      totalTasks: row.total_tasks,
      doneTasks: row.done_tasks,
      workers: (row.workers ?? []).map(
        (worker): ProjectWorker => ({
          memberId: worker.member_id,
          userId: worker.user_id,
          name: worker.display_name ?? worker.full_name ?? worker.email,
          avatarUrl: worker.avatar_url,
          openTasks: worker.open_tasks,
        }),
      ),
    }))
  },

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const { data, error } = await getSupabase()
      .from('project_members')
      .select(
        `member_id, added_at,
         member:organization_members!project_members_member_id_fkey (
           id, user_id,
           profile:profiles!organization_members_user_id_fkey (
             id, email, full_name, display_name, avatar_url, title, timezone, last_seen_at
           )
         )`,
      )
      .eq('project_id', projectId)
      .order('added_at')

    if (error) throw toAppError(error)

    return ((data ?? []) as unknown[]).flatMap((entry): ProjectMember[] => {
      const row = entry as { member_id: string; added_at: string; member: unknown }
      const member = firstOf(row.member) as { user_id: string; profile: unknown } | null
      const profile = firstOf(member?.profile) as {
        id: string
        email: string
        full_name: string | null
        display_name: string | null
        avatar_url: string | null
        title: string | null
        timezone: string
        last_seen_at: string | null
      } | null
      // A membership whose profile is gone is not a person to draw.
      if (!member || !profile) return []

      return [
        {
          memberId: row.member_id,
          userId: member.user_id,
          addedAt: row.added_at,
          profile: {
            id: profile.id,
            email: profile.email,
            fullName: profile.full_name,
            displayName: profile.display_name,
            avatarUrl: profile.avatar_url,
            title: profile.title,
            timezone: profile.timezone,
            lastSeenAt: profile.last_seen_at,
          },
        },
      ]
    })
  },

  async addMember(projectId: string, memberId: string): Promise<void> {
    const { error } = await getSupabase().rpc('add_project_member', {
      p_project_id: projectId,
      p_member_id: memberId,
    })
    if (error) throw toAppError(error)
  },

  async removeMember(projectId: string, memberId: string): Promise<void> {
    const { error } = await getSupabase().rpc('remove_project_member', {
      p_project_id: projectId,
      p_member_id: memberId,
    })
    if (error) throw toAppError(error)
  },
}

/**
 * Demo mode has no projects.
 *
 * The demo backend is an in-memory store with seeded channels and people; it
 * has no projects, and inventing some would be showing fictional work as
 * though it were planned. Reads are empty and writes say why.
 */
const DEMO_MESSAGE = 'Projects are not part of demo mode.'

const demoProjectService: ProjectService = {
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(null),
  overview: () => Promise.resolve([]),
  create: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  update: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  transition: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  archive: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  restore: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  remove: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  listMembers: () => Promise.resolve([]),
  addMember: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
  removeMember: () => Promise.reject(new AppError('validation', DEMO_MESSAGE)),
}

function impl(): ProjectService {
  return isDemoSessionActive() ? demoProjectService : supabaseProjectService
}

export const projectService: ProjectService = {
  list: (organizationId) => impl().list(organizationId),
  get: (projectId) => impl().get(projectId),
  overview: (organizationId) => impl().overview(organizationId),
  create: (input) => impl().create(input),
  update: (projectId, input) => impl().update(projectId, input),
  transition: (projectId, move) => impl().transition(projectId, move),
  archive: (projectId) => impl().archive(projectId),
  restore: (projectId) => impl().restore(projectId),
  remove: (projectId) => impl().remove(projectId),
  listMembers: (projectId) => impl().listMembers(projectId),
  addMember: (projectId, memberId) => impl().addMember(projectId, memberId),
  removeMember: (projectId, memberId) => impl().removeMember(projectId, memberId),
}
