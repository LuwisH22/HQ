import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { InviteLanding } from '@/features/auth/InviteLanding'
import { useAuthDeepLinks } from '@/features/auth/useAuthDeepLinks'
import { WorkspaceProvider } from '@/features/organization/WorkspaceProvider'
import { EnvironmentError } from '@/features/setup/EnvironmentError'
import { PresenceHeartbeat } from '@/features/organization/PresenceHeartbeat'
import { createQueryClient } from '@/lib/query-client'
import { envResult } from '@/lib/env'
import { isDemoModeAvailable } from '@/lib/demo-mode'
import { useUiStore } from '@/stores/ui.store'
import { router } from '@/routes/router'

// One client for the whole app, created outside the component so a re-render
// can never blow away the cache.
const queryClient = createQueryClient()

/** Applies the theme preference to the document root. */
function useThemeEffect() {
  const theme = useUiStore((state) => state.theme)

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      root.classList.toggle('dark', dark)
      root.style.colorScheme = dark ? 'dark' : 'light'
    }

    apply()
    if (theme !== 'system') return

    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

function AppProviders() {
  useThemeEffect()
  // Desktop only, and mounted once: the app is the sole consumer of
  // `lfghq://auth/...` links.
  useAuthDeepLinks()

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WorkspaceProvider>
          <TooltipProvider delayDuration={400} skipDelayDuration={300}>
            <PresenceHeartbeat />
            <InviteLanding>
              <RouterProvider router={router} />
            </InviteLanding>
            <Toaster
              theme="dark"
              position="bottom-right"
              closeButton
              richColors
              toastOptions={{ duration: 5000 }}
            />
          </TooltipProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export function App() {
  // Without valid Supabase configuration nothing below can reach a backend, so
  // this is checked before any provider mounts and shows actionable setup
  // guidance instead of a wall of network errors.
  //
  // The exception is a development build, where demo mode can run the whole
  // app against a local store — so the app is allowed to boot and the sign-in
  // screen explains the situation and offers that entry point.
  if (!envResult.ok && !isDemoModeAvailable()) {
    return <EnvironmentError errors={envResult.errors} />
  }

  return (
    <ErrorBoundary>
      <AppProviders />
    </ErrorBoundary>
  )
}
