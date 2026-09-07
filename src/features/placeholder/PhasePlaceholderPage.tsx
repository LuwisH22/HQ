import type { Icon } from '@phosphor-icons/react'
import { PageHeader } from '@/components/common/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Stand-in for a section whose phase has not been built.
 *
 * Navigation deliberately still lists these, so the shape of the finished
 * product is visible from day one — but the page says plainly that the feature
 * is not here yet instead of showing a mock that looks functional.
 */
export function PhasePlaceholderPage({
  title,
  icon: Icon,
  summary,
  capabilities,
}: {
  title: string
  icon: Icon
  /**
   * The build phase this section belongs to. Still accepted so the call sites
   * and routes stay as they are, and deliberately not rendered: a phase number
   * is how the work is planned, not something a reader of this page can use.
   */
  phase: number
  summary: string
  capabilities: readonly string[]
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Icon className="text-muted-foreground size-4" aria-hidden="true" />
            {title}
          </span>
        }
        description={summary}
        actions={<Badge variant="neutral">Not available yet</Badge>}
      />

      <Card>
        <CardContent className="pt-4">
          <p className="text-xs font-medium">Planned for this section</p>
          <ul className="mt-3 space-y-1.5">
            {capabilities.map((capability) => (
              <li key={capability} className="text-muted-foreground flex items-start gap-2 text-xs">
                <span
                  className="bg-muted-foreground/50 mt-1.5 size-1 shrink-0 rounded-full"
                  aria-hidden="true"
                />
                {capability}
              </li>
            ))}
          </ul>
          <p className="border-border text-2xs text-muted-foreground/70 mt-4 border-t pt-3">
            The navigation, permissions and data access for this section already exist. Only the
            feature itself is pending.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
