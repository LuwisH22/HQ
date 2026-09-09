import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { firstOf } from './postgrest'
import type { ProjectReviewComment, ReviewCommentService } from './service-contracts'

export type { ProjectReviewComment } from './service-contracts'

/**
 * What people said while reviewing a project.
 *
 * Not paginated, unlike a task's comments: a review is a handful of remarks
 * about one project between people who are all looking at it, not a thread
 * that grows for months. If one ever needs turning back, the keyset shape in
 * `comment.service` is the one to copy.
 *
 * The columns are named one by one and never `*`. `deleted_body` — where a
 * deleted comment's words go — is not granted to any client, so asking for the
 * whole row is refused outright. That refusal is the point: it fails loudly
 * rather than quietly returning something it should not.
 */

const COLUMNS = `id, project_id, author_id, body, review_round, deleted_at, deleted_by,
   created_at, updated_at,
   author:profiles!project_review_comments_author_id_fkey (
     id, display_name, full_name, email, avatar_url
   )`

interface Row {
  id: string
  project_id: string
  author_id: string | null
  body: string
  review_round: number
  deleted_at: string | null
  deleted_by: string | null
  created_at: string
  updated_at: string
  author: unknown
}

function toComment(row: Row): ProjectReviewComment {
  const author = firstOf(row.author) as {
    display_name: string | null
    full_name: string | null
    email: string
    avatar_url: string | null
  } | null

  return {
    id: row.id,
    projectId: row.project_id,
    authorId: row.author_id,
    // Already empty for a deleted comment: the database emptied it, and the
    // words are somewhere this client cannot reach.
    body: row.body,
    authorName: author?.display_name ?? author?.full_name ?? author?.email ?? 'Removed member',
    authorAvatarUrl: author?.avatar_url ?? null,
    reviewRound: row.review_round,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const supabaseReviewCommentService: ReviewCommentService = {
  async list(projectId: string): Promise<ProjectReviewComment[]> {
    const { data, error } = await getSupabase()
      .from('project_review_comments')
      .select(COLUMNS)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

    if (error) throw toAppError(error)
    return ((data ?? []) as unknown as Row[]).map(toComment)
  },

  async create(projectId: string, body: string): Promise<string> {
    const { data, error } = await getSupabase().rpc('create_project_review_comment', {
      p_project_id: projectId,
      p_body: body,
    })

    if (error) throw toAppError(error)
    return data
  },

  async update(commentId: string, body: string): Promise<void> {
    const { error } = await getSupabase().rpc('update_project_review_comment', {
      p_comment_id: commentId,
      p_body: body,
    })

    if (error) throw toAppError(error)
  },

  /** Soft: the row stays, the words go somewhere no client may read. */
  async remove(commentId: string): Promise<void> {
    const { error } = await getSupabase().rpc('delete_project_review_comment', {
      p_comment_id: commentId,
    })
    if (error) throw toAppError(error)
  },
}

/** Demo mode has no projects, so it has no reviews either. */
const DEMO_MESSAGE = 'Projects are not part of demo mode.'
const refuse = () => Promise.reject(new AppError('validation', DEMO_MESSAGE))

const demoReviewCommentService: ReviewCommentService = {
  list: () => Promise.resolve([]),
  create: refuse,
  update: refuse,
  remove: refuse,
}

function impl(): ReviewCommentService {
  return isDemoSessionActive() ? demoReviewCommentService : supabaseReviewCommentService
}

export const reviewCommentService: ReviewCommentService = {
  list: (projectId) => impl().list(projectId),
  create: (projectId, body) => impl().create(projectId, body),
  update: (commentId, body) => impl().update(commentId, body),
  remove: (commentId) => impl().remove(commentId),
}
