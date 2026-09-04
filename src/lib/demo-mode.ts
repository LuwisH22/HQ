/**
 * Development demo mode.
 *
 * Lets the application run end to end with no Supabase project, so Phase 1 can
 * be exercised locally while a backend is unavailable. It is a *development
 * tool*, not an authentication system.
 *
 * ## Why this cannot be enabled in production
 *
 * The gate below starts with `import.meta.env.DEV`. Vite replaces that with the
 * literal `false` in any production build (`npm run build`, and therefore
 * `npm run desktop:build`), so `isDemoModeAvailable()` collapses to a constant
 * `false` that the bundler can fold away. On top of that, `vite.config.ts`
 * aliases the entire `@/services/demo` module to a stub for production builds,
 * so the demo implementation and its seed data are not even present in the
 * shipped bundle.
 *
 * There is no environment variable, no build flag and no runtime toggle that
 * turns demo mode on in a production build. Getting it back would require
 * editing this file.
 *
 * ## Turning it off in development
 *
 * Set `VITE_DEMO_MODE=false` in `.env`. Once real Supabase credentials are in
 * place, the sign-in form works normally and the demo entry point can simply be
 * ignored — no code changes are needed to move to the real backend.
 */

const DEMO_SESSION_KEY = 'lfg-hq-demo-session'

/** True only in a development build where demo mode has not been opted out of. */
export function isDemoModeAvailable(): boolean {
  if (!import.meta.env.DEV) return false
  return import.meta.env.VITE_DEMO_MODE !== 'false'
}

/**
 * True when the user actually signed in through the demo entry point.
 *
 * Every service dispatches on this per call, so a demo session and a real
 * Supabase session can never be mixed within one page load.
 */
export function isDemoSessionActive(): boolean {
  if (!isDemoModeAvailable()) return false
  try {
    return window.localStorage.getItem(DEMO_SESSION_KEY) === 'active'
  } catch {
    // Private browsing or a locked-down webview: treat as no demo session.
    return false
  }
}

export function startDemoSession(): void {
  if (!isDemoModeAvailable()) {
    throw new Error('Demo mode is not available in this build.')
  }
  window.localStorage.setItem(DEMO_SESSION_KEY, 'active')
}

export function endDemoSession(): void {
  try {
    window.localStorage.removeItem(DEMO_SESSION_KEY)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
