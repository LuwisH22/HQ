import { useEffect } from 'react'
import { profileService } from '@/services/profile.service'
import { useAuth } from '@/hooks/use-auth'

/** How often to refresh `last_seen_at` while the app is in the foreground. */
const HEARTBEAT_INTERVAL_MS = 2 * 60_000

/**
 * Keeps `profiles.last_seen_at` current so the roster can show presence.
 *
 * The timer stops while the window is hidden — a minimised desktop app should
 * cost nothing, and someone who left the app open overnight is not "online".
 * Phase 2 replaces this with a realtime presence channel; the shape of what
 * the UI consumes does not change.
 */
export function PresenceHeartbeat() {
  const { status } = useAuth()

  useEffect(() => {
    if (status !== 'authenticated') return

    let timer: ReturnType<typeof setInterval> | undefined

    const beat = () => {
      if (document.visibilityState === 'visible') {
        void profileService.touchLastSeen()
      }
    }

    const start = () => {
      if (timer !== undefined) return
      beat()
      timer = setInterval(beat, HEARTBEAT_INTERVAL_MS)
    }

    const stop = () => {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    onVisibilityChange()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stop()
    }
  }, [status])

  return null
}
