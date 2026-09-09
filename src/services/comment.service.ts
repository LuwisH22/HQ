import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { firstOf } from './postgrest'
import type { CommentPage, CommentService, TaskComment } from './service-contracts'

export type { CommentPage, TaskComment } from './service-contracts'

/**
 * What people have said about a task.
 *
 * Keyset paginated on `created_at`, the way the message list is: `before` is
 * the oldest comment already held, so turning a page costs the same whether it
 * is the first or the twentieth, and nothing shifts underneath a reader when
 * somebody comments while they are reading.
 *
 * The columns are named one by one and never `*`. `deleted_body` — where a
 * deleted comment's words go — is not granted to any client, so asking for the
 * whole row is refused outright. That refusal is the point: it fails loudly
 * rather than quietly returning something it should not.
 */

const PAGE_SIZE = 20

const COLUMNS = `id, task_id, author_id, body, deleted_at, deleted_by, created_at, updated_at,
   author:profiles!task_comments_author_id_fkey ( id, display_name, full_name, email, avatar_url )`

interface Row {
  id: string
  task_id: string
  author_id: string | null
  body: string
  deleted_at: string | null
  deleted_by: string | null
  created_at: string
  updated_at: string
  author: unknown
}

function toComment(row: Row): TaskComment {
  const author = firstOf(row.author) as {
    display_name: string | null
    full_name: string | null
    email: string
    avatar_url: string | null
  } | null

  return {
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    // Already empty for a deleted comment: the database emptied it, and the
    // words are somewhere this client cannot reach.
    body: row.body,
    authorName: author?.display_name ?? author?.full_name ?? author?.email ?? 'Removed member',
    authorAvatarUrl: author?.avatar_url ?? null,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const supabaseCommentService: CommentService = {
  async list(taskId: string, before?: string): Promise<CommentPage> {
    let query = getSupabase()
      .from('task_comments')
      .select(COLUMNS)
      .eq('task_id', taskId)
      // Newest first for the query, so a page is the most recent ones; the
      // list is turned back the right way round below.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1)

    if (before) query = query.lt('created_at', before)

    const { data, error } = await query
    if (error) throw toAppError(error)

    const rows = (data ?? []) as unknown as Row[]
    const hasMore = rows.length > PAGE_SIZE
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows

    return { comments: page.map(toComment).reverse(), hasMore }
  },

  async create(taskId: string, body: string): Promise<string> {
    const { data, error } = await getSupabase().rpc('create_task_comment', {
      p_task_id: taskId,
      p_body: body,
    })

    if (error) throw toAppError(error)
    return data
  },

  async update(commentId: string, body: string): Promise<void> {
    const { error } = await getSupabase().rpc('update_task_comment', {
      p_comment_id: commentId,
      p_body: body,
    })

    if (error) throw toAppError(error)
  },

  /** Soft: the row stays, the words go somewhere no client may read. */
  async remove(commentId: string): Promise<void> {
    const { error } = await getSupabase().rpc('delete_task_comment', { p_comment_id: commentId })
    if (error) throw toAppError(error)
  },
}

/** Demo mode has no projects, so it has no comments either. */
const DEMO_MESSAGE = 'Projects are not part of demo mode.'
const refuse = () => Promise.reject(new AppError('validation', DEMO_MESSAGE))

const demoCommentService: CommentService = {
  list: () => Promise.resolve({ comments: [], hasMore: false }),
  create: refuse,
  update: refuse,
  remove: refuse,
}

function impl(): CommentService {
  return isDemoSessionActive() ? demoCommentService : supabaseCommentService
}

export const commentService: CommentService = {
  list: (taskId, before) => impl().list(taskId, before),
  create: (taskId, body) => impl().create(taskId, body),
  update: (commentId, body) => impl().update(commentId, body),
  remove: (commentId) => impl().remove(commentId),
}
