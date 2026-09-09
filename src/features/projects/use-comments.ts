import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { commentService, type TaskComment } from '@/services/comment.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { mergeComments } from './comment-body'

/**
 * One task's comments, a page at a time.
 *
 * Keyset rather than offset, as the message list is: `before` is the oldest
 * comment already held, so an older page costs the same as the first and
 * nothing shifts underneath a reader when somebody comments while they read.
 *
 * The pages are kept in local state rather than in an infinite query because
 * what the list needs is simple — a growing tail of older comments — and the
 * newest page is what a refetch has to replace.
 *
 * How many pages are held, rather than only what is in them, because a keyset
 * cursor goes out of date. The tail was fetched from wherever the newest page
 * ended at the time; when somebody comments, the newest page ends later, and
 * the comments in between belonged to neither half and disappeared from the
 * middle of the list. So the count is what is remembered, and the tail is
 * re-walked from the current end whenever the newest page changes. Refetching
 * became common the moment realtime arrived, which is what made a rare gap
 * worth closing properly.
 */
export function useComments(
  organizationId: string | undefined,
  taskId: string | undefined,
  enabled = true,
) {
  const [older, setOlder] = useState<TaskComment[]>([])
  const [pages, setPages] = useState(0)
  const [moreOlder, setMoreOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const query = useQuery({
    queryKey: queryKeys.projects.comments(organizationId ?? 'none', taskId ?? 'none'),
    queryFn: () => commentService.list(taskId as string),
    enabled: Boolean(organizationId) && Boolean(taskId) && enabled,
    staleTime: 15_000,
  })

  // Oldest first, and nothing twice. The merge itself is a pure function, so
  // the part of a list that is easy to get subtly wrong is tested on its own.
  const comments = useMemo(
    () => mergeComments(older, query.data?.comments ?? []),
    [older, query.data],
  )

  const oldest = comments[0]
  // Once there is a tail, it is the tail that knows whether anything is behind
  // it; the newest page answered that question about a boundary that has moved.
  const hasMore = pages > 0 ? moreOlder : (query.data?.hasMore ?? false)

  // Where the newest page currently ends. Read inside the effect below, which
  // must not re-run every time the object identity changes.
  const edge = useRef<string | undefined>(undefined)
  edge.current = query.data?.comments[0]?.createdAt

  const loadOlder = useCallback(async () => {
    if (!taskId || !oldest || loadingOlder) return
    setLoadingOlder(true)
    try {
      const page = await commentService.list(taskId, oldest.createdAt)
      setOlder((current) => [...page.comments, ...current])
      setPages((count) => count + 1)
      setMoreOlder(page.hasMore)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoadingOlder(false)
    }
  }, [loadingOlder, oldest, taskId])

  const freshAt = query.dataUpdatedAt

  useEffect(() => {
    const from = edge.current
    if (pages === 0 || !taskId || !from) return

    let abandoned = false

    void (async () => {
      const found: TaskComment[] = []
      let cursor: string | undefined = from
      let more = false

      // The same number of pages, from where the list ends now. One request in
      // the ordinary case, because reading past the first page at all is rare.
      for (let page = 0; page < pages; page += 1) {
        const next = await commentService.list(taskId, cursor)
        if (next.comments.length === 0) break
        found.unshift(...next.comments)
        cursor = next.comments[0]?.createdAt
        more = next.hasMore
      }

      // A closed dialog, another task, or a newer refetch already on its way.
      if (abandoned) return
      setOlder(found)
      setMoreOlder(more)
    })().catch(() => {
      // A tail that could not be refreshed keeps the rows it had. The newest
      // page is what people read, and it is already current.
    })

    return () => {
      abandoned = true
    }
  }, [freshAt, pages, taskId])

  const reset = useCallback(() => {
    setOlder([])
    setPages(0)
    setMoreOlder(false)
  }, [])

  return { query, comments, hasMore, loadOlder, loadingOlder, reset }
}

/**
 * Writing, changing and taking back a comment.
 *
 * Only the comment family is invalidated: saying something about a task does
 * not move it, and the board has no reason to redraw.
 */
export function useCommentMutations(
  organizationId: string | undefined,
  taskId: string | undefined,
) {
  const queryClient = useQueryClient()
  const key = queryKeys.projects.comments(organizationId ?? 'none', taskId ?? 'none')

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: key })
  }
  const complain = (error: unknown) => {
    toast.error(errorMessage(error))
  }

  const create = useMutation({
    mutationFn: (body: string) => commentService.create(taskId as string, body),
    onSuccess: invalidate,
    onError: complain,
  })

  const update = useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      commentService.update(commentId, body),
    onSuccess: invalidate,
    onError: complain,
  })

  const remove = useMutation({
    mutationFn: (commentId: string) => commentService.remove(commentId),
    onSuccess: invalidate,
    onError: complain,
  })

  return { create, update, remove }
}
