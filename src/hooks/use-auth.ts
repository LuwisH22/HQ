import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context'

/** Session state. Throws if used outside AuthProvider, which is a wiring bug. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return context
}
