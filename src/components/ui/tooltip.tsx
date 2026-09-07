import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'bg-popover edge-light text-foreground z-50 overflow-hidden rounded-sm px-2 py-1 text-xs font-medium shadow-lg',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
          'data-[state=delayed-open]:fade-in-0 data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
})

/**
 * Keyboard shortcut hint rendered inside a tooltip, e.g. `Ctrl K`.
 * Rendered as separate keys so screen readers do not read it as one token.
 */
function TooltipShortcut({ keys }: { keys: readonly string[] }) {
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5">
      {keys.map((key) => (
        <kbd
          key={key}
          className="border-border bg-elevated text-2xs text-secondary-foreground rounded-xs border px-[5px] font-mono font-medium"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipShortcut }
