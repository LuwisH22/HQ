import { X } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import type { Label } from '@/services/label.service'
import { LABEL_BADGE_VARIANT } from './label-colors'

/**
 * One label, small.
 *
 * A Badge in one of the six variants the application already has — not a pill
 * of its own design, and not a colour a client chose. The name carries the
 * meaning; the tone is a second reading of it.
 */
export function LabelChip({
  label,
  onRemove,
}: {
  label: Label
  /** When present, the chip carries a way to take the label off. */
  onRemove?: () => void
}) {
  return (
    <Badge variant={LABEL_BADGE_VARIANT[label.color]} className="gap-1 pr-1">
      <span className="truncate">{label.name}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label.name}`}
          onClick={onRemove}
          className="hover:text-foreground rounded-xs opacity-60 transition-opacity hover:opacity-100 focus-visible:ring-1 focus-visible:outline-none"
        >
          <X className="size-2.5" aria-hidden="true" />
        </button>
      ) : null}
    </Badge>
  )
}
