import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ProjectWorker } from '@/services/project.service'
import { cn } from '@/lib/utils'

/** Two letters from a name, the way every other avatar in the app does it. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)
  return letters.toUpperCase()
}

/**
 * Who currently has unfinished work on a project.
 *
 * Not the roster. A project can be for six people while two of them are
 * actually carrying something, and "6 members" told a reader neither of those
 * things. This is derived from assignment — somebody with at least one task
 * here that is not done — so it cannot go stale the way a second stored
 * relationship would.
 *
 * It says nothing about presence. Nobody here is online, recently seen, or
 * available; they have work open, which is a fact about the board.
 */
export function WorkerAvatars({
  workers,
  limit = 4,
  className,
}: {
  workers: readonly ProjectWorker[]
  limit?: number
  className?: string
}) {
  if (workers.length === 0) {
    return (
      <span className={cn('text-muted-foreground text-3xs', className)}>No active assignees</span>
    )
  }

  const shown = workers.slice(0, limit)
  const rest = workers.slice(limit)
  const everyone = workers.map((worker) => worker.name).join(', ')

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {/*
        One name list for a screen reader, because eight overlapping avatars
        read as eight images with no relationship between them.
      */}
      <span className="sr-only">{`Working on it: ${everyone}`}</span>

      <div aria-hidden="true" className="flex -space-x-1.5">
        {shown.map((worker) => (
          <Tooltip key={worker.memberId}>
            <TooltipTrigger asChild>
              <Avatar className="border-background size-5 border">
                <AvatarImage src={worker.avatarUrl ?? undefined} alt="" />
                <AvatarFallback className="text-[8px]">{initialsOf(worker.name)}</AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>
              {`${worker.name} · ${String(worker.openTasks)} open`}
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
            <TooltipContent>{rest.map((worker) => worker.name).join(', ')}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}
