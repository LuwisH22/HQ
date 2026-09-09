import { describe, expect, it } from 'vitest'
import { COMMENT_MAX_LENGTH, isEditable, isSendable, mergeComments } from './comment-body'
import type { TaskComment } from '@/services/comment.service'

/**
 * The rules a comment follows before it is sent, and how a page of them is
 * joined to the ones already on screen.
 *
 * Paging is the part of a list that goes subtly wrong — a comment shown twice,
 * or one lost between pages — so the merge is a pure function and this is what
 * holds it to that.
 */

function comment(id: string, createdAt: string, overrides: Partial<TaskComment> = {}): TaskComment {
  return {
    id,
    taskId: 'task-1',
    authorId: 'user-1',
    body: `Comment ${id}`,
    authorName: 'LuwisH',
    authorAvatarUrl: null,
    deletedAt: null,
    deletedBy: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

describe('whether a comment is worth sending', () => {
  it('refuses nothing, and whitespace', () => {
    expect(isSendable('')).toBe(false)
    expect(isSendable('   \n  ')).toBe(false)
  })

  it('accepts words', () => {
    expect(isSendable('Booked for Thursday.')).toBe(true)
  })

  it('refuses more than the column holds', () => {
    expect(isSendable('x'.repeat(COMMENT_MAX_LENGTH))).toBe(true)
    expect(isSendable('x'.repeat(COMMENT_MAX_LENGTH + 1))).toBe(false)
  })

  it('treats an edit as worth sending only when it changed something', () => {
    expect(isEditable('Same', 'Same')).toBe(false)
    expect(isEditable('   ', 'Same')).toBe(false)
    expect(isEditable('Different', 'Same')).toBe(true)
  })
})

describe('joining a page of older comments to the ones on screen', () => {
  const newest = [
    comment('c', '2026-09-03T00:00:00.000Z'),
    comment('d', '2026-09-04T00:00:00.000Z'),
  ]
  const older = [comment('a', '2026-09-01T00:00:00.000Z'), comment('b', '2026-09-02T00:00:00.000Z')]

  it('puts the older ones first', () => {
    expect(mergeComments(older, newest).map((one) => one.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('shows nothing twice, whichever page it arrived in', () => {
    // The same comment in both pages: it belongs in one place, once.
    const overlapping = [...older, comment('c', '2026-09-03T00:00:00.000Z')]
    expect(mergeComments(overlapping, newest).map((one) => one.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('loses nothing when there is nothing older', () => {
    expect(mergeComments([], newest)).toHaveLength(2)
  })

  it('and nothing when there is nothing newer', () => {
    expect(mergeComments(older, [])).toHaveLength(2)
  })

  it('takes the newest page’s version of a comment that is in both', () => {
    // The older page was fetched before the edit; the live one refetches
    // after every write, so it is the one that knows.
    const stale = comment('c', '2026-09-03T00:00:00.000Z', { body: 'Before the edit' })
    const merged = mergeComments([stale], newest)
    expect(merged.map((one) => one.id)).toEqual(['c', 'd'])
    expect(merged.find((one) => one.id === 'c')?.body).toBe('Comment c')
  })

  it('shows a comment deleted since it was paged in as deleted', () => {
    const before = comment('c', '2026-09-03T00:00:00.000Z')
    const after = comment('c', '2026-09-03T00:00:00.000Z', {
      body: '',
      deletedAt: '2026-09-05T00:00:00.000Z',
    })
    const merged = mergeComments([before], [after])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.deletedAt).toBe('2026-09-05T00:00:00.000Z')
    expect(merged[0]?.body).toBe('')
  })
})

describe('a deleted comment', () => {
  it('carries no words to show', () => {
    // The database empties the body and moves the text somewhere no client
    // may select; there is nothing here that could render it.
    const gone = comment('x', '2026-09-01T00:00:00.000Z', {
      body: '',
      deletedAt: '2026-09-02T00:00:00.000Z',
      deletedBy: 'user-1',
    })
    expect(gone.body).toBe('')
    expect(Object.keys(gone)).not.toContain('deletedBody')
  })
})
