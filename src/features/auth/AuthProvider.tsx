import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { voiceCommands } from '@/services/voice-session'
import { authService } from '@/services/auth.service'
import type { AuthIdentity } from '@/services/service-contracts'
import { useUiStore } from '@/stores/ui.store'
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context'

/**
 * Owns the session lifecycle.
 *
 * There is exactly one auth subscription in the app, here. Components read the
 * result through `useAuth` rather than subscribing themselves, which keeps
 * token refreshes from fanning out into re-renders across the tree.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthIdentity | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const queryClient = useQueryClient()
  const setActiveOrganization = useUiStore((state) => state.setActiveOrganization)

  // Tracks the previous user so a token refresh (same user) does not clear the
  // cache, while an actual account switch does.
  const previousUserId = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void authService
      .getSession()
      .then((initial) => {
        if (cancelled) return
        previousUserId.current = initial?.id ?? null
        setUser(initial)
        setStatus(initial ? 'authenticated' : 'unauthenticated')
      })
      .catch(() => {
        if (cancelled) return
        // A corrupt or expired persisted session is a signed-out state, not an
        // error worth showing the user.
        setUser(null)
        setStatus('unauthenticated')
      })

    const unsubscribe = authService.onAuthStateChange((next) => {
      if (cancelled) return

      const nextUserId = next?.id ?? null
      const userChanged = previousUserId.current !== nextUserId

      setUser(next)
      setStatus(next ? 'authenticated' : 'unauthenticated')

      if (userChanged) {
        previousUserId.current = nextUserId
        // Never serve one account's cached rows to another.
        queryClient.clear()
        // Nor leave one account's microphone open for the next. A page
        // changing is not a reason to end a call; the account changing is.
        void voiceCommands.endForSignOut()
        if (!nextUserId) setActiveOrganization(null)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [queryClient, setActiveOrganization])

  const signOut = useCallback(async () => {
    await authService.signOut()
    queryClient.clear()
    setActiveOrganization(null)
  }, [queryClient, setActiveOrganization])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signOut }),
    [status, user, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
