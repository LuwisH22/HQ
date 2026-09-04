import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type ThemePreference = 'dark' | 'light' | 'system'

/**
 * Client-only UI state.
 *
 * Deliberately small. Anything that comes from the server lives in TanStack
 * Query, not here — mirroring server data into a global store is how caches
 * drift out of sync.
 *
 * What *is* persisted is only local preference: which organization was open,
 * whether the sidebar was collapsed, the theme. Nothing here is sensitive, and
 * nothing here is trusted for authorization.
 */
interface UiState {
  activeOrganizationId: string | null
  sidebarCollapsed: boolean
  mobileNavOpen: boolean
  commandPaletteOpen: boolean
  theme: ThemePreference

  setActiveOrganization: (organizationId: string | null) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setMobileNavOpen: (open: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  setTheme: (theme: ThemePreference) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeOrganizationId: null,
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandPaletteOpen: false,
      theme: 'dark',

      setActiveOrganization: (activeOrganizationId) => set({ activeOrganizationId }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      toggleCommandPalette: () =>
        set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'lfg-hq-ui',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Transient state must not survive a restart: nobody wants to reopen the
      // app to a command palette they closed yesterday.
      partialize: (state) => ({
        activeOrganizationId: state.activeOrganizationId,
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      }),
    },
  ),
)
