import type * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Nocturne's tag. Three treatments only — accent, neutral, outline. Anything
 * that used to be colour-coded (warning, destructive, success) resolves to one
 * of these, because the system is mono.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm px-[7px] py-0.5 text-2xs leading-none font-medium',
  {
    variants: {
      variant: {
        default: 'bg-primary/14 text-accent-text',
        accent: 'bg-primary/14 text-accent-text',
        neutral: 'bg-foreground/8 text-muted-foreground',
        secondary: 'bg-foreground/8 text-muted-foreground',
        outline: 'border-border text-muted-foreground border',
        // Mono palette: these keep their names for call sites but read as
        // outline, per the handoff's badge table.
        success: 'border-border text-muted-foreground border',
        warning: 'border-border text-muted-foreground border',
        destructive: 'border-border text-muted-foreground border',
        signal: 'bg-primary/14 text-accent-text',
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
