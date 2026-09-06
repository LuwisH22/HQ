import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { CardSkeleton } from '@/components/common/states'
import { useUiStore } from '@/stores/ui.store'
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { MobileNavDrawer, MobileTabBar } from './MobileNav'
import { CommandPalette } from './CommandPalette'
import { ProfileDialog } from '@/features/profile/ProfileDialog'
import { useUnreadRealtime } from '@/features/channels/use-unread'
import { VoiceSessionBar } from '@/features/voice/VoiceSessionBar'

/**
 * The persistent application frame.
 *
 * Only the outlet re-renders on navigation — the sidebar, header and tab bar
 * are mounted once for the life of the session, which is what makes moving
 * between sections feel instant rather than like a page load.
 */
export function AppShell() {
  const setSidebarCollapsed = useUiStore((state) => state.setSidebarCollapsed)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)

  useKeyboardShortcut({ key: 'b', mod: true }, () => setSidebarCollapsed(!sidebarCollapsed))
  useKeyboardShortcut({ key: 'Escape', allowInInput: true }, () => setMobileNavOpen(false))

  // One organization-wide subscription for the whole app, not one per
  // rendered channel list.
  useUnreadRealtime()

  return (
    <div className="bg-background flex h-dvh w-full overflow-hidden">
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none"
        >
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="p-6">
                  <CardSkeleton lines={6} />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
        {/* Above the tab bar and never over it: the same session the sidebar
            shows, drawn for a phone. */}
        <VoiceSessionBar layout="bar" />
        <MobileTabBar />
      </div>

      <MobileNavDrawer />
      <CommandPalette />
      {/* Outside the drawer deliberately: a dialog rendered inside it would be
          marked hidden along with everything else the drawer covers. */}
      <ProfileDialog />
    </div>
  )
}
