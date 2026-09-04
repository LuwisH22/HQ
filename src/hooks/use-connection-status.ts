import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting'

/**
 * Tracks whether the app can reach the network.
 *
 * Phase 1 has no realtime channels yet, so this watches the browser's
 * online/offline events. It is deliberately shaped as the seam that Phase 2's
 * realtime channel state will report into, so the connection banner and the
 * resync-on-reconnect behaviour are already in place when chat lands.
 */
export function useConnectionStatus(): ConnectionStatus {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    typeof navigator === 'undefined' || navigator.onLine ? 'online' : 'offline',
  )

  useEffect(() => {
    function handleOnline() {
      setStatus('reconnecting')
      // Anything cached while offline is suspect; refetch what is on screen.
      void queryClient.refetchQueries({ type: 'active' }).finally(() => setStatus('online'))
    }

    function handleOffline() {
      setStatus('offline')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [queryClient])

  return status
}
