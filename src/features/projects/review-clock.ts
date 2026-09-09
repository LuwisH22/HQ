/**
 * How a review deadline reads, and whether it has passed.
 *
 * Pure, and apart from the component that draws it, because this is the part
 * that is easy to get quietly wrong — an off-by-one on an hour boundary, or a
 * deadline that reads "0 minutes" for a whole minute — and it is arithmetic on
 * two numbers, so it can be checked without a clock or a screen.
 *
 * None of it is authoritative. The instant lives on the project row, written
 * by the server, and completing the project re-reads it there; this only
 * decides what a person is told while they wait.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "2 days", "3 hours", "14 minutes", "under a minute". */
export function remainingLabel(ms: number): string {
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY)
    return `${String(days)} day${days === 1 ? '' : 's'}`
  }
  if (ms >= HOUR) {
    const hours = Math.floor(ms / HOUR)
    return `${String(hours)} hour${hours === 1 ? '' : 's'}`
  }
  if (ms >= MINUTE) {
    const minutes = Math.floor(ms / MINUTE)
    return `${String(minutes)} minute${minutes === 1 ? '' : 's'}`
  }
  return 'under a minute'
}

/**
 * Whether a review is open to being completed.
 *
 * A review with no deadline is always past it: "no limit" means there is
 * nothing to wait for, and `transition_project` agrees — it only refuses a
 * completion when a deadline exists and is still ahead.
 */
export function deadlinePassed(deadline: string | null, now: number): boolean {
  if (deadline === null) return true
  const at = Date.parse(deadline)
  // An unparseable timestamp is not a licence to complete early.
  if (Number.isNaN(at)) return false
  return at <= now
}
