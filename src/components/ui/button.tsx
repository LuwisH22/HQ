import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { CircleNotch } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

/**
 * Blackout's primary action is a fill in the saturated accent, with a 1px
 * `accent/glow` along its top edge — light from above, the way a screen lights
 * a face. It is the only place in the app the accent fills a shape, and it
 * covers well under one percent of any screen, which is what keeps the accent
 * meaning "state" everywhere else.
 *
 * Everything else is a tonal step: secondary on the elevated plane, ghost on
 * nothing at all. Hover moves one step up and never casts a shadow.
 *
 * The focus ring is deliberately absent here: `@layer base` gives every
 * focusable element the system's 2px accent outline at 2px offset.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-sm border border-transparent bg-transparent text-sm font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] select-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0 [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        // The fill, the edge-light, and a glow that only appears on hover.
        default:
          'bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgb(207_200_255/0.35)] hover:bg-[#7565ff] hover:shadow-[inset_0_1px_0_0_rgb(207_200_255/0.35),0_0_0_1px_rgb(169_156_255/0.4),0_0_16px_rgb(102_86_240/0.25)] active:bg-accent-deep',
        secondary:
          'bg-elevated border-border text-foreground hover:bg-accent hover:border-border-strong active:bg-surface',
        // Kept as a distinct name because call sites use it; visually the same
        // bordered treatment as `secondary`.
        outline:
          'bg-elevated border-border text-foreground hover:bg-accent hover:border-border-strong active:bg-surface',
        ghost: 'text-secondary-foreground hover:bg-accent hover:text-foreground active:bg-surface',
        destructive:
          'text-destructive hover:bg-destructive/10 active:bg-destructive/16 border-transparent',
        link: 'text-accent-text underline-offset-4 hover:underline',
      },
      // 28 / 32 / 36 / 40, with icons at 16 in sm and 18 above it.
      size: {
        default: 'h-8 px-3 [&_svg]:size-[18px]',
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-4',
        lg: 'h-9 px-4 [&_svg]:size-[18px]',
        xl: 'h-10 px-4 [&_svg]:size-[18px]',
        icon: 'size-8 border-0 px-0 [&_svg]:size-[18px]',
        'icon-sm': 'size-7 border-0 px-0 [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

/**
 * While `loading`, the button disables itself and shows a spinner alongside its
 * label, so a submitting form neither reflows nor accepts a second click.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <CircleNotch className="animate-spin" aria-hidden="true" />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
})

export { Button, buttonVariants }
