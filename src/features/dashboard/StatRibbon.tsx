import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * The four headline figures, on one surface.
 *
 * A ribbon rather than a grid of cards: the same numbers, one border instead
 * of four, and half the height. The dividers between them are the quietest
 * line in the system, because the figures are what separate the columns — the
 * rule only says where one ends.
 *
 * Numerals are Archivo semi-condensed and tabular, so a number changing does
 * not move the ones beside it.
 */

export interface Stat {
  /** Eyebrow. Uppercase is applied by the class, not by the string. */
  label: string
  value: string | number
  hint: string
  loading?: boolean
}

export function StatRibbon({ stats }: { stats: readonly Stat[] }) {
  return (
    <section
      aria-label="Organization at a glance"
      className="border-border bg-card grid grid-cols-2 rounded-md border lg:grid-cols-4"
    >
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={cn(
            'border-border-subtle min-w-0 px-4 py-3.5',
            // Dividers between, never around: the ribbon's own border is the
            // edge, and a divider on the outside would double it.
            index % 2 === 1 && 'border-l',
            index >= 2 && 'border-t',
            'lg:border-t-0',
            index > 0 && 'lg:border-l',
          )}
        >
          <p className="display-eyebrow text-3xs text-muted-foreground truncate">{stat.label}</p>

          {stat.loading ? (
            <Skeleton className="mt-1.5 h-8 w-16" />
          ) : (
            <p className="display-stat text-foreground mt-1 truncate text-[32px] leading-9 font-semibold">
              {stat.value}
            </p>
          )}

          <p className="text-2xs text-muted-foreground mt-1 truncate">{stat.hint}</p>
        </div>
      ))}
    </section>
  )
}
