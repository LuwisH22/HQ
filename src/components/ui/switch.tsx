import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-[120ms]',
        'focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-border-strong',
        className,
      )}
      {...props}
    >
      {/* White knob, not the ground colour: the track is dark either way, and
          a knob that matched it would vanish when off. */}
      <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 rounded-full bg-white ring-0 transition-transform duration-[120ms] data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  )
})

export { Switch }
