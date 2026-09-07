import type * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Blackout's tag.
 *
 * Semantic colour is back, and each colour means one thing: green is
 * connected, amber is unsaved or reconnecting, red is an error. Brass marks
 * rank and ownership and appears at most twice on a screen.
 *
 * Sentence case, never caps: the eyebrow is the app's uppercase device, and a
 * badge is not an eyebrow.
 */
const badgeVariants = cva(
  'inline-flex h-5 items-center gap-1 rounded-xs px-1.5 text-2xs leading-none font-semibold tracking-[0.02em] [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary/14 text-accent-text border border-primary/30',
        accent: 'bg-primary/14 text-accent-text border border-primary/30',
        // Rank and ownership.
        brass: 'bg-brass/12 text-brass border border-brass/30',
        neutral: 'bg-elevated text-secondary-foreground border-border border',
        secondary: 'bg-elevated text-secondary-foreground border-border border',
        outline: 'border-border text-muted-foreground border',
        success: 'bg-success/12 text-success border border-success/30',
        warning: 'bg-warning/12 text-warning border border-warning/30',
        destructive: 'bg-destructive/12 text-destructive border border-destructive/30',
        signal: 'bg-primary/14 text-accent-text border border-primary/30',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
