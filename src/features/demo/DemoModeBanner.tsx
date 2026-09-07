import { useState } from 'react'
import { Flask, ArrowCounterClockwise } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isDemoSessionActive } from '@/lib/demo-mode'

/**
 * Persistent "this is not production" marker.
 *
 * Rendered in the application header whenever a demo session is active, in the
 * warning colour so it cannot be mistaken for ordinary chrome. It also carries
 * the reset control, since restoring the seed data is the one demo-specific
 * action worth having at hand.
 */
export function DemoModeBanner() {
  const queryClient = useQueryClient()
  const [resetting, setResetting] = useState(false)

  if (!isDemoSessionActive()) return null

  async function handleReset() {
    setResetting(true)
    try {
      const { resetDemoData } = await import('@/services/demo')
      resetDemoData()
      await queryClient.invalidateQueries()
      toast.success('Demo data restored to its original state.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="app-no-drag flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="status"
            className="border-demo/50 text-demo text-3xs display-eyebrow inline-flex items-center gap-1.5 rounded-sm border px-2 py-1"
          >
            <Flask className="size-3" aria-hidden="true" />
            Demo mode
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          Local development data only. No Supabase project is connected and nothing here is saved
          anywhere but this browser.
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            loading={resetting}
            onClick={() => void handleReset()}
            aria-label="Reset demo data"
            className="text-muted-foreground"
          >
            {resetting ? null : <ArrowCounterClockwise aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Reset demo data to the seed</TooltipContent>
      </Tooltip>
    </div>
  )
}
