import type { LabelColor } from '@/types/database.types'
import type { BadgeProps } from '@/components/ui/badge'

/**
 * The six a label may be.
 *
 * Tokens rather than colours: each one is a Badge variant this application
 * already draws, so a label can never carry styling of its own and there is
 * nothing in it for a stylesheet to be injected through. The database holds
 * the same six in a CHECK, so the two cannot drift.
 */
export const LABEL_COLORS = ['violet', 'brass', 'success', 'warning', 'danger', 'neutral'] as const

export const LABEL_COLOR_LABELS: Record<LabelColor, string> = {
  violet: 'Violet',
  brass: 'Brass',
  success: 'Green',
  warning: 'Amber',
  danger: 'Red',
  neutral: 'Neutral',
}

/** Which Badge variant draws each one. */
export const LABEL_BADGE_VARIANT: Record<LabelColor, NonNullable<BadgeProps['variant']>> = {
  violet: 'accent',
  brass: 'brass',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
  neutral: 'neutral',
}

/** The small mark a card shows, which is the same six and nothing new. */
export const LABEL_DOT_TONE: Record<LabelColor, string> = {
  violet: 'bg-primary',
  brass: 'bg-brass',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  neutral: 'bg-border-strong',
}
