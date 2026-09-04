import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(function Avatar({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn('bg-muted relative flex size-8 shrink-0 overflow-hidden rounded-md', className)}
      {...props}
    />
  )
})

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(function AvatarImage({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Image
      ref={ref}
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  )
})

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(function AvatarFallback({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(
        'bg-elevated text-2xs text-muted-foreground flex size-full items-center justify-center rounded-md font-semibold tracking-wide uppercase',
        className,
      )}
      {...props}
    />
  )
})

/** Online / away / offline dot, positioned against an Avatar in a relative wrapper. */
function AvatarStatus({
  status,
  className,
}: {
  status: 'online' | 'away' | 'offline'
  className?: string
}) {
  const label = status === 'online' ? 'Online' : status === 'away' ? 'Away' : 'Offline'
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'border-surface absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2',
        status === 'online' && 'bg-success',
        status === 'away' && 'bg-warning',
        status === 'offline' && 'bg-muted-foreground/50',
        className,
      )}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback, AvatarStatus }
