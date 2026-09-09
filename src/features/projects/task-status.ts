import type { TaskPriority, TaskStatus } from '@/types/database.types'

/**
 * The five columns, in the order the board draws them.
 *
 * A label and an order, and nothing else: no policy or routine reads any of
 * this to decide what anybody may do. `done` is the only one that means more
 * than a word, and what it means — a completion timestamp — lives in the
 * routine that moves a task there.
 */
export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
}

/**
 * How much a task matters.
 *
 * Ordered from least to most, which is the order a select offers them in.
 * Never colour alone: the card writes the word, and the mark beside it is a
 * second reading of the same thing rather than the only one.
 */
export const TASK_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

/**
 * The mark on a card.
 *
 * Two tokens and a neutral, because five colours on a small card is a
 * decoration rather than a signal. Only what is above ordinary gets one.
 */
export const TASK_PRIORITY_TONE: Record<TaskPriority, string> = {
  none: 'bg-border-strong',
  low: 'bg-border-strong',
  medium: 'bg-muted-foreground',
  high: 'bg-brass',
  urgent: 'bg-destructive',
}
