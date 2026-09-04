import type { MemberStatus } from '@/types/database.types'

/**
 * Effective membership status.
 *
 * Mirrors `is_effectively_active()` in Postgres, which is the authority. This
 * exists so the interface can label a member correctly without a round trip —
 * it decides what is *shown*, never what is *allowed*.
 *
 * A suspension is stored with an expiry rather than scheduled for reversal, so
 * "has it lapsed?" is answered by comparing timestamps at read time. There is
 * no cron job and therefore no window in which the row disagrees with reality.
 */
export function effectiveMemberStatus(
  status: MemberStatus,
  suspendedUntil: string | null,
  now: Date = new Date(),
): MemberStatus {
  // A ban never lapses. Checking it first means a stale timestamp can never
  // be mistaken for an expiry.
  if (status === 'banned') return 'banned'
  if (status !== 'suspended') return 'active'

  // No expiry means indefinite: only an explicit unsuspend ends it.
  if (suspendedUntil === null) return 'suspended'

  const ends = Date.parse(suspendedUntil)
  if (Number.isNaN(ends)) return 'suspended'

  return ends <= now.getTime() ? 'active' : 'suspended'
}

/** Whether the member may currently use the organization. */
export function isEffectivelyActive(
  status: MemberStatus,
  suspendedUntil: string | null,
  now: Date = new Date(),
): boolean {
  return effectiveMemberStatus(status, suspendedUntil, now) === 'active'
}

/** Human-readable suspension expiry, or null when there is nothing to show. */
export function suspensionEndsAt(
  status: MemberStatus,
  suspendedUntil: string | null,
  now: Date = new Date(),
): Date | null {
  if (effectiveMemberStatus(status, suspendedUntil, now) !== 'suspended') return null
  if (suspendedUntil === null) return null
  const ends = new Date(suspendedUntil)
  return Number.isNaN(ends.getTime()) ? null : ends
}

/** Suspension lengths the moderation dialog offers. `null` is indefinite. */
export const SUSPENSION_DURATIONS: ReadonlyArray<{ label: string; days: number | null }> = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'Until lifted', days: null },
]
