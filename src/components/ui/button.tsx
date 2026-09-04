import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { CircleNotch } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

/**
 * Nocturne's primary action is an accent outline on transparent — never a
 * fill. Emphasis comes from the border and the hover tint, so a screen can
 * carry several actions without one of them shouting.
 *
 * The focus ring is deliberately absent here: `@layer base` gives every
 * focusable element the system's 2px accent outline at 2px offset.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-sm border border-transparent bg-transparent text-sm font-medium whitespace-nowrap transition-[background-color,color,border-color] duration-[140ms] select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'border-primary text-foreground hover:bg-primary/14 active:bg-primary/22',
        secondary: 'border-border text-foreground hover:bg-foreground/7 active:bg-foreground/11',
        // Kept as a distinct name because call sites use it; visually the same
        // bordered treatment as `secondary`.
        outline: 'border-border text-foreground hover:bg-foreground/7 active:bg-foreground/11',
        ghost: 'text-foreground hover:bg-foreground/7 active:bg-foreground/11',
        destructive:
          'border-destructive text-destructive hover:bg-destructive/12 active:bg-destructive/18',
        // The accent at body size is too dim to read; the 300 step is the one
        // Nocturne uses for accent-coloured text.
        link: 'text-accent-text underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3 py-1.5',
        sm: 'h-7 px-2.5',
        lg: 'h-9 px-5',
        icon: 'size-7 border-0 px-0',
        'icon-sm': 'size-7 border-0 px-0',
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
