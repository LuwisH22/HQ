import type { TaskComment } from '@/services/comment.service'

/**
 * The rules a comment's text follows, in one place.
 *
 * The same two the routine applies — something in it, and under four thousand
 * characters — so the composer can refuse before the round trip rather than
 * after it.
 */
export const COMMENT_MAX_LENGTH = 4000

export function isSendable(body: string): boolean {
  const trimmed = body.trim()
  return trimmed.length > 0 && trimmed.length <= COMMENT_MAX_LENGTH
}

/** Whether an edit is worth sending: different, and still a comment. */
export function isEditable(draft: string, original: string): boolean {
  return isSendable(draft) && draft !== original
}

/**
 * Merging a page of older comments into the ones already held.
 *
 * Oldest first, and nothing twice: a comment that arrives in the newest page
 * after having been paged in as an older one must appear once, in one place.
 * Pure, because paging is the part of a list that is easy to get subtly wrong
 * and hard to see going wrong.
 */
export function mergeComments(
  older: readonly TaskComment[],
  newest: readonly TaskComment[],
): TaskComment[] {
  // Where a comment is in both, the newest page wins: that is the one the
  // live query refetches after every write, so it holds the edit or the
  // deletion the older page was fetched before.
  const fresh = new Map(newest.map((comment) => [comment.id, comment]))
  const out: TaskComment[] = []
  const seen = new Set<string>()

  for (const comment of older) {
    if (seen.has(comment.id)) continue
    seen.add(comment.id)
    out.push(fresh.get(comment.id) ?? comment)
  }
  for (const comment of newest) {
    if (seen.has(comment.id)) continue
    seen.add(comment.id)
    out.push(comment)
  }
  return out
}
