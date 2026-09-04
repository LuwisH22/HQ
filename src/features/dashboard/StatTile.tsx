import type { Icon } from '@phosphor-icons/react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * A single headline figure.
 *
 * The value is rendered at a size that reads from across a desk, with the
 * label and hint kept quiet — high information density without shouting.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  loading = false,
  accent = 'default',
}: {
  icon: Icon
  label: string
  value: string | number
  hint?: string
  loading?: boolean
  accent?: 'default' | 'success' | 'warning'
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-3.5">
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            accent === 'success' && 'text-success',
            accent === 'warning' && 'text-warning',
            accent === 'default' && 'text-muted-foreground',
          )}
          aria-hidden="true"
        />
        <p className="text-3xs text-muted-foreground truncate font-semibold tracking-[0.1em] uppercase">
          {label}
        </p>
      </div>

      {loading ? (
        <Skeleton className="mt-2 h-7 w-12" />
      ) : (
        <p className="mt-1.5 truncate text-[26px] leading-none font-medium tracking-[-0.015em] tabular-nums">
          {value}
        </p>
      )}

      {hint ? <p className="text-3xs text-foreground/45 mt-1.5 truncate">{hint}</p> : null}
    </div>
  )
}
