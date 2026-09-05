import { useEffect, useMemo, useState } from 'react'
import type { MentionCandidate } from '@/services/channel.service'

/**
 * Finding, inserting and filtering `@handle` in a plain text composer.
 *
 * Pure functions, deliberately: what counts as a mention being typed is the
 * fiddliest part of the feature and the easiest to get subtly wrong, so it is
 * testable without mounting anything.
 *
 * None of this decides who may be mentioned. It narrows a list the server
 * already scoped, and the trigger resolves the mention again when the message
 * lands — typing a name nobody holds simply sends plain text.
 */

/** How far back from the caret an unfinished `@handle` may start. */
const MAX_HANDLE = 40

/** The same shape the database trigger parses by. */
export const HANDLE_PATTERN = /@([A-Za-z0-9._-]{2,40})/g

export interface MentionQuery {
  /** Index of the `@`. */
  start: number
  /** Text typed after it, lowercased. */
  term: string
}

/**
 * The `@handle` being typed at the caret, if there is one.
 *
 * The `@` must start a word, so an address in the middle of a sentence does
 * not open a menu, and the term stops at anything a handle cannot contain, so
 * a finished mention followed by more words stops matching.
 */
export function mentionQueryAt(value: string, caret: number): MentionQuery | null {
  if (caret < 0 || caret > value.length) return null

  const from = Math.max(0, caret - MAX_HANDLE - 1)
  const window = value.slice(from, caret)
  const at = window.lastIndexOf('@')
  if (at === -1) return null

  const start = from + at
  const before = start === 0 ? '' : value[start - 1]
  // `a@b` is an address, not a mention.
  if (before !== undefined && before !== '' && !/\s/.test(before)) return null

  const term = value.slice(start + 1, caret)
  if (!/^[A-Za-z0-9._-]*$/.test(term)) return null

  return { start, term: term.toLowerCase() }
}

/** Replace the `@term` at the caret with a chosen handle, and a trailing space. */
export function applyMention(
  value: string,
  query: MentionQuery,
  handle: string,
  caret: number,
): { value: string; caret: number } {
  return {
    value: `${value.slice(0, query.start)}@${handle} ${value.slice(caret)}`,
    caret: query.start + handle.length + 2,
  }
}

/** Filter and cap the roster for a term. */
export function matchCandidates(
  candidates: readonly MentionCandidate[],
  term: string,
): MentionCandidate[] {
  const matches =
    term === ''
      ? [...candidates]
      : candidates.filter(
          (c) =>
            c.handle.toLowerCase().includes(term) || c.displayName.toLowerCase().includes(term),
        )

  // A menu taller than the composer is a menu nobody reads.
  return matches.slice(0, 8)
}

/** Keyboard state for the menu, kept out of the composer's own concerns. */
export function useMentionMenu(candidates: readonly MentionCandidate[], term: string | null) {
  const [activeIndex, setActiveIndex] = useState(0)

  const matches = useMemo(
    () => (term === null ? [] : matchCandidates(candidates, term)),
    [candidates, term],
  )

  // A term that narrows the list must not leave the highlight past its end.
  useEffect(() => {
    setActiveIndex(0)
  }, [term])

  return {
    matches,
    activeIndex: Math.min(activeIndex, Math.max(matches.length - 1, 0)),
    setActiveIndex,
    move(delta: number) {
      setActiveIndex((current) => {
        if (matches.length === 0) return 0
        return (current + delta + matches.length) % matches.length
      })
    },
  }
}
