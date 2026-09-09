import { useEffect, useState } from 'react'
import { deadlinePassed } from './review-clock'

/**
 * Whether a review deadline is behind us, kept current without a refresh.
 *
 * The same interval the countdown uses, for the same reason: what turns
 * "Review ends in a minute" into a completable project is the passing of an
 * instant, not an event anybody sends. A review with no deadline is always
 * past it — that is what "no limit" means, and the routine agrees.
 */
export function useDeadlinePassed(deadline: string | null): boolean {
  const at = deadline ? Date.parse(deadline) : null
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // Nothing to wait for, or nothing left to wait for: no interval either way.
    if (at === null || at <= Date.now()) return
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 15_000)
    return () => {
      clearInterval(timer)
    }
  }, [at])

  return deadlinePassed(deadline, now)
}
