import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Nocturne treats elevation as a hairline edge, not a drop shadow — so the
 * card carries `shadow-sm` (redefined in index.css as a 1px inset ring) and
 * has no border property of its own. Never stack the two.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('bg-card text-card-foreground border-border rounded-md border', className)}
      {...props}
    />
  )
})

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex flex-col gap-1 p-4 pb-3', className)} {...props} />
  },
)

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, ...props }, ref) {
    return (
      <h3
        ref={ref}
        className={cn('text-[14px] leading-none font-semibold tracking-[-0.01em]', className)}
        {...props}
      />
    )
  },
)

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return <p ref={ref} className={cn('text-muted-foreground text-xs', className)} {...props} />
})

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />
  },
)

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex items-center p-4 pt-0', className)} {...props} />
  },
)

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
