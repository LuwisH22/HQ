import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { reviewCommentService, type ProjectReviewComment } from '@/services/review-comment.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'

/**
 * The review conversation about a project.
 *
 * Read whole rather than a page at a time. A task's comments are keyset
 * paginated because a thread on a piece of work can run for months; a review
 * is a handful of remarks between people looking at the same project, and
 * paging it would be machinery for a list that fits on a screen.
 *
 * Every round is here, oldest first, including the rounds that ended in
 * changes being requested. That is the point of keeping them: a reviewer
 * looking at round three should be able to read what was said in round one.
 */
export function useReviewComments(
  organizationId: string | undefined,
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.projects.review(organizationId ?? 'none', projectId ?? 'none'),
    queryFn: (): Promise<ProjectReviewComment[]> => reviewCommentService.list(projectId as string),
    enabled: Boolean(organizationId) && Boolean(projectId) && enabled,
    staleTime: 15_000,
  })
}

/**
 * Writing, changing and taking back a review comment.
 *
 * Only the review family is invalidated: saying something about a project does
 * not move it along, and neither the board nor the header has any reason to
 * redraw.
 */
export function useReviewCommentMutations(
  organizationId: string | undefined,
  projectId: string | undefined,
) {
  const queryClient = useQueryClient()
  const key = queryKeys.projects.review(organizationId ?? 'none', projectId ?? 'none')

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: key })
  }
  const complain = (error: unknown) => {
    toast.error(errorMessage(error))
  }

  const create = useMutation({
    mutationFn: (body: string) => reviewCommentService.create(projectId as string, body),
    onSuccess: invalidate,
    onError: complain,
  })

  const update = useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      reviewCommentService.update(commentId, body),
    onSuccess: invalidate,
    onError: complain,
  })

  const remove = useMutation({
    mutationFn: (commentId: string) => reviewCommentService.remove(commentId),
    onSuccess: invalidate,
    onError: complain,
  })

  return { create, update, remove }
}
