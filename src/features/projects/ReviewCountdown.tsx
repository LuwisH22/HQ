import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { deadlinePassed, remainingLabel } from './review-clock'

/**
 * How long a review has left.
 *
 * Presentation, and only presentation. The instant it counts towards is a
 * column on the row, written by the server from its own clock, and completing
 * the project re-reads that column and refuses if it has not passed — so a
 * browser with a wrong clock, a tab left open overnight, or a Tauri window
 * restarted an hour later all show something slightly different and none of
 * them can bring a completion forward.
 *
 * Nothing here polls the database. One interval per mounted countdown, and it
 * stops as soon as the deadline is behind it.
 */

export function ReviewCountdown({
  deadline,
  className,
}: {
  /** The server's instant, or null for a review with no limit. */
  deadline: string | null
  className?: string
}) {
  const at = deadline ? Date.parse(deadline) : null
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (at === null) return
    // A minute is the finest thing this ever says, so a minute is how often it
    // needs to think. The screen still updates the moment the deadline passes
    // because the tick that crosses it is the one that changes the sentence.
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 15_000)
    return () => {
      clearInterval(timer)
    }
  }, [at])

  if (at === null) {
    return (
      <span className={cn('text-muted-foreground text-3xs font-mono', className)}>
        No review deadline
      </span>
    )
  }

  const left = at - now
  const over = deadlinePassed(deadline, now)

  return (
    <span
      // Polite, not assertive: a countdown reaching zero is worth hearing at
      // the next pause, not worth interrupting somebody mid-sentence.
      aria-live="polite"
      className={cn(
        'text-3xs font-mono',
        over ? 'text-brass' : 'text-muted-foreground',
        className,
      )}
    >
      {over ? 'Review period ended' : `Review ends in ${remainingLabel(left)}`}
    </span>
  )
}
