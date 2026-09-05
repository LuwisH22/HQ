import type { Message } from '@/services/message.service'

/**
 * When a run of messages is one person talking.
 *
 * Shared by the channel and the conversation timelines rather than written
 * twice: the rule is about messages, not about the kind of place they are in,
 * and two copies of it would eventually disagree about what a burst looks
 * like.
 */

/** A run of messages is one person talking if it is close enough in time. */
const GROUPING_WINDOW_MS = 5 * 60_000

export function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

export function continuesRun(previous: Message | undefined, message: Message): boolean {
  if (!previous) return false
  if (previous.authorId !== message.authorId) return false
  if (previous.deletedAt !== null || message.deletedAt !== null) return false
  // A pinned message is being singled out; folding it into the run above
  // would hide the very thing that was pinned.
  if (message.pinnedAt !== null) return false
  // A reply carries a line saying what it answers, and that line needs the
  // name above it to make sense of who is answering whom.
  if (message.parentMessageId !== null) return false
  if (!sameDay(previous.createdAt, message.createdAt)) return false
  return (
    new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
    GROUPING_WINDOW_MS
  )
}
