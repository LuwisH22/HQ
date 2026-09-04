import * as React from 'react'
import { cn } from '@/lib/utils'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

/**
 * Recessed like `Input`, and sized by its content.
 *
 * Auto-growing is left to the caller: a composer wants to stop growing at a
 * few lines, a description field wants to keep going, and baking one of those
 * in here would be wrong for the other.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'border-input bg-background caret-primary flex w-full resize-none rounded-sm border px-2.5 py-[7px] text-sm transition-[border-color] duration-[140ms]',
        'placeholder:text-muted-foreground/70',
        'focus-visible:border-primary focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-45',
        'aria-[invalid=true]:border-destructive',
        className,
      )}
      {...props}
    />
  )
})

export { Textarea }
