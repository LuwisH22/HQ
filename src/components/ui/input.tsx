import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/**
 * Recessed: the field takes the ground colour so it reads as cut into the
 * surface it sits on, rather than floating above it.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type, ...props },
  ref,
) {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        'border-input bg-background caret-primary flex h-[34px] w-full rounded-sm border px-2.5 py-[7px] text-sm transition-[border-color] duration-[140ms]',
        'placeholder:text-muted-foreground/70',
        'focus-visible:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-45',
        'aria-[invalid=true]:border-destructive',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  )
})

export { Input }
