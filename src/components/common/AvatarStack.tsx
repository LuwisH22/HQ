import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Two letters from a name, the way every other avatar in the app does it. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)
  return letters.toUpperCase()
}

export interface StackedPerson {
  id: string
  name: string
  avatarUrl: string | null
  /** Anything worth saying beside the name on hover. Optional. */
  detail?: string
}

/**
 * A few people, overlapping, with the rest counted.
 *
 * Overlapping avatars are a picture rather than a list, so the picture is
 * hidden from assistive technology and one sentence of names is offered
 * instead — eight images with no relationship between them is not what a row
 * of faces means.
 *
 * It says nothing about presence. Nobody here is online, recently seen or
 * available; they are on a list, and the caller says which list.
 */
export function AvatarStack({
  people,
  limit = 4,
  summaryLabel,
  emptyLabel,
  className,
}: {
  people: readonly StackedPerson[]
  limit?: number
  /** How the sr-only sentence opens, e.g. "Roster" or "Working on it". */
  summaryLabel: string
  /** What to say when there is nobody. */
  emptyLabel: string
  className?: string
}) {
  if (people.length === 0) {
    return <span className={cn('text-muted-foreground text-3xs', className)}>{emptyLabel}</span>
  }

  const shown = people.slice(0, limit)
  const rest = people.slice(limit)
  const everyone = people.map((person) => person.name).join(', ')

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <span className="sr-only">{`${summaryLabel}: ${everyone}`}</span>

      <div aria-hidden="true" className="flex -space-x-1.5">
        {shown.map((person) => (
          <Tooltip key={person.id}>
            <TooltipTrigger asChild>
              <Avatar className="border-background size-5 border">
                <AvatarImage src={person.avatarUrl ?? undefined} alt="" />
                <AvatarFallback className="text-[8px]">{initialsOf(person.name)}</AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>
              {person.detail ? `${person.name} · ${person.detail}` : person.name}
            </TooltipContent>
          </Tooltip>
        ))}

        {rest.length > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  'border-background bg-elevated text-muted-foreground text-[8px]',
                  'flex size-5 items-center justify-center rounded-full border font-mono',
                )}
              >
                {`+${String(rest.length)}`}
              </span>
            </TooltipTrigger>
            <TooltipContent>{rest.map((person) => person.name).join(', ')}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}
