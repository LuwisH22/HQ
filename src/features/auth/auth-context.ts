import { createContext } from 'react'
import type { AuthIdentity } from '@/services/service-contracts'

/**
 * `loading` is the boot state before the session has been restored. Routing
 * must wait for it to resolve, otherwise a returning user is bounced to the
 * sign-in screen for a frame before their session loads.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthContextValue {
  status: AuthStatus
  /**
   * Deliberately narrower than a Supabase `Session`. Nothing in the app needs
   * access tokens, and keeping the shape minimal is what allows a second
   * implementation (development demo mode) to satisfy the same contract.
   */
  user: AuthIdentity | null
  /** Clears the session and every cached query belonging to it. */
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
