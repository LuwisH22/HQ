/**
 * Presence derived from the `last_seen_at` heartbeat.
 *
 * Phase 1 has no realtime presence channel, so this is an honest approximation
 * from a timestamp rather than a live signal. Phase 2 replaces the source
 * without changing this vocabulary.
 */

export type PresenceState = 'online' | 'away' | 'offline'

const ONLINE_WINDOW_MS = 5 * 60_000
const AWAY_WINDOW_MS = 30 * 60_000

export function presenceFrom(
  lastSeenAt: string | null | undefined,
  now = Date.now(),
): PresenceState {
  if (!lastSeenAt) return 'offline'
  const seen = new Date(lastSeenAt).getTime()
  if (Number.isNaN(seen)) return 'offline'

  const elapsed = now - seen
  if (elapsed <= ONLINE_WINDOW_MS) return 'online'
  if (elapsed <= AWAY_WINDOW_MS) return 'away'
  return 'offline'
}

export function presenceLabel(state: PresenceState): string {
  switch (state) {
    case 'online':
      return 'Online'
    case 'away':
      return 'Away'
    case 'offline':
      return 'Offline'
  }
}
