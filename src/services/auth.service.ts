import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { envResult, getEnv } from '@/lib/env'
import { isDesktop } from '@/lib/platform'
import { isDemoModeAvailable, isDemoSessionActive } from '@/lib/demo-mode'
import { demoAuthService } from '@/services/demo'
import type { AuthIdentity, AuthService, Credentials } from './service-contracts'

export type { AuthIdentity, Credentials } from './service-contracts'

/**
 * Authentication.
 *
 * LFG HQ is invitation-only: there is no `signUp` here, and the Supabase
 * project has signups disabled. Accounts come into existence exactly one way —
 * an operator with `members.invite` triggers the `invite-user` Edge Function.
 *
 * The exported `authService` dispatches per call to either the Supabase
 * implementation below or the development demo backend. See
 * `src/lib/demo-mode.ts` for why the demo branch cannot exist in production.
 */

/** Supabase auth errors are already user-facing; map the ones worth rewording. */
function mapAuthError(error: unknown): AppError {
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : ''

  if (/invalid login credentials/i.test(message)) {
    return new AppError('auth', 'That email and password combination is not recognised.', {
      cause: error,
    })
  }
  if (/email not confirmed/i.test(message)) {
    return new AppError('auth', 'Confirm your email address before signing in.', { cause: error })
  }
  if (/signups not allowed|signup is disabled/i.test(message)) {
    return new AppError('forbidden', 'LFG HQ is invitation-only. Ask an admin for an invite.', {
      cause: error,
    })
  }
  if (/rate limit|too many/i.test(message)) {
    return new AppError('rate_limited', 'Too many attempts. Please wait a minute and try again.', {
      cause: error,
    })
  }
  return toAppError(error)
}

/**
 * Where auth emails should send the user back to. The desktop build uses a
 * registered deep link so the installed app is reopened rather than a browser.
 */
function redirectTo(path: string): string {
  if (isDesktop()) return `lfghq://auth${path}`
  return `${getEnv().VITE_PUBLIC_SITE_URL}/#/auth${path}`
}

/**
 * Narrow a Supabase user to the identity the application actually needs.
 *
 * Keeping `Session` out of the app is what lets a second implementation exist
 * at all — nothing above this line depends on Supabase's session shape.
 */
function toIdentity(user: { id: string; email?: string | undefined } | null): AuthIdentity | null {
  if (!user) return null
  return { id: user.id, email: user.email ?? '' }
}

export const supabaseAuthService: AuthService = {
  async getSession() {
    const { data, error } = await getSupabase().auth.getSession()
    if (error) throw mapAuthError(error)
    return toIdentity(data.session?.user ?? null)
  },

  async getUser() {
    const { data, error } = await getSupabase().auth.getUser()
    if (error) {
      // A missing session is a normal signed-out state, not a failure.
      if (/session|jwt/i.test(error.message)) return null
      throw mapAuthError(error)
    }
    return toIdentity(data.user)
  },

  async signInWithPassword({ email, password }: Credentials) {
    const { data, error } = await getSupabase().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) throw mapAuthError(error)
    const identity = toIdentity(data.session?.user ?? null)
    if (!identity) {
      throw new AppError('auth', 'Sign-in did not complete. Please try again.')
    }
    return identity
  },

  /**
   * Magic-link sign-in for an existing member. `shouldCreateUser: false` is
   * load-bearing: without it this becomes a public registration endpoint.
   */
  async signInWithMagicLink(email: string) {
    const { error } = await getSupabase().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo('/callback'),
      },
    })
    if (error) throw mapAuthError(error)
  },

  async requestPasswordReset(email: string) {
    const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: redirectTo('/reset-password'),
    })
    if (error) throw mapAuthError(error)
  },

  async updatePassword(password: string) {
    const { error } = await getSupabase().auth.updateUser({ password })
    if (error) throw mapAuthError(error)
  },

  async signOut() {
    const { error } = await getSupabase().auth.signOut()
    if (error) throw mapAuthError(error)
  },

  /** Redeem an invitation token for the signed-in user. Returns the org id. */
  async acceptInvitation(token: string) {
    const { data, error } = await getSupabase().rpc('accept_invitation', { p_token: token })
    if (error) throw toAppError(error)
    if (!data) throw new AppError('unknown', 'The invitation could not be redeemed.')
    return data
  },

  onAuthStateChange(callback) {
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      callback(toIdentity(session?.user ?? null))
    })
    return () => data.subscription.unsubscribe()
  },
}

/**
 * The implementation to use for this call.
 *
 * Resolved per call rather than at module load, so signing into — or out of —
 * a demo session takes effect immediately without a reload.
 */
function impl(): AuthService {
  return isDemoSessionActive() ? demoAuthService : supabaseAuthService
}

/** Whether the Supabase client can be constructed at all. */
function backendConfigured(): boolean {
  return envResult.ok
}

export const authService: AuthService = {
  getSession: () => {
    if (isDemoSessionActive()) return demoAuthService.getSession()
    // Without credentials there is no session to restore — and asking Supabase
    // would throw. Signed-out is the correct answer, not an error.
    if (!backendConfigured()) return Promise.resolve(null)
    return supabaseAuthService.getSession()
  },
  getUser: () => {
    if (isDemoSessionActive()) return demoAuthService.getUser()
    if (!backendConfigured()) return Promise.resolve(null)
    return supabaseAuthService.getUser()
  },
  signInWithPassword: (credentials) => impl().signInWithPassword(credentials),
  signInWithMagicLink: (email) => impl().signInWithMagicLink(email),
  requestPasswordReset: (email) => impl().requestPasswordReset(email),
  updatePassword: (password) => impl().updatePassword(password),
  signOut: () => impl().signOut(),
  acceptInvitation: (token) => impl().acceptInvitation(token),

  /**
   * Subscribes to whichever backends exist, not just the active one.
   *
   * Starting a demo session is itself an auth-state change, and at that moment
   * the active implementation is still the Supabase one. Listening to both
   * means the provider is notified either way, with no reload.
   */
  onAuthStateChange: (callback) => {
    const unsubscribers: Array<() => void> = []

    if (isDemoModeAvailable()) {
      unsubscribers.push(demoAuthService.onAuthStateChange(callback))
    }

    if (backendConfigured()) {
      unsubscribers.push(
        supabaseAuthService.onAuthStateChange((identity) => {
          // Supabase emits INITIAL_SESSION with a null session on every boot.
          // While a demo session owns the app that event is not about us, and
          // forwarding it would sign the user out on every page reload.
          if (isDemoSessionActive()) return
          callback(identity)
        }),
      )
    }

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  },
}
