import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const PHASE_LABELS: Record<number, string> = {
  2: 'Chat',
  3: 'Projects',
  4: 'Calendar',
  5: 'Files',
  6: 'Notifications',
}

/**
 * Placeholder for a dashboard widget whose data source arrives in a later
 * phase.
 *
 * It states plainly that the section is not built yet. The alternative —
 * sample events and fake task counts — would be indistinguishable from real
 * data on a dashboard people are meant to trust.
 */
export function UpcomingPanel({
  title,
  icon: Icon,
  description,
  availableInPhase,
}: {
  title: string
  icon: LucideIcon
  description: string
  availableInPhase: number
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <Icon className="text-muted-foreground size-3.5" aria-hidden="true" />
        <CardTitle className="flex-1">{title}</CardTitle>
        <Badge variant="outline">Phase {availableInPhase}</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
        <p className="text-2xs text-muted-foreground/70 mt-3">
          Arrives with {PHASE_LABELS[availableInPhase] ?? 'a later phase'}.
        </p>
      </CardContent>
    </Card>
  )
}
