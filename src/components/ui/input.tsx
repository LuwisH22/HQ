import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/**
 * A well. The field takes the canvas colour so it reads as cut into the
 * surface it sits on rather than floating above it — the one thing in
 * Blackout that sits *below* its plane. Hovering strengthens the edge;
 * focusing turns it accent and adds a soft ring, so the border is the ring.
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
        'border-input bg-background caret-accent-text flex h-8 w-full rounded-sm border px-3 text-sm transition-[border-color,box-shadow] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
        'placeholder:text-muted-foreground',
        'hover:border-border-strong',
        'focus-visible:border-accent-text focus-visible:shadow-[0_0_0_3px_rgb(169_156_255/0.22)] focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
        'aria-[invalid=true]:border-destructive',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  )
})

export { Input }
