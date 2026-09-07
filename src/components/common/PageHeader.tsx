import { cn } from '@/lib/utils'

/**
 * Consistent page title block: eyebrow, heading, supporting line, actions.
 *
 * The eyebrow is what a page is; the title is which one. `h1` already takes
 * the display family from the base layer, so the title is Archivo without
 * asking.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  /** Small uppercase line above the title. Optional, and never a sentence. */
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="display-eyebrow text-3xs text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 text-[22px] leading-7 font-semibold tracking-[-0.015em]">{title}</h1>
        {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
