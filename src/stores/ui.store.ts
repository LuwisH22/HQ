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
  /**
   * Whether the profile dialog is open.
   *
   * It lives here rather than inside the button that opens it because the
   * button exists twice — in the sidebar and in the phone drawer — and the
   * dialog has to be mounted outside the drawer to be reachable at all.
   */
  profileOpen: boolean
  theme: ThemePreference
  /**
   * Channel categories the member has folded shut in the sidebar, by id.
   *
   * A list of what is closed rather than what is open: a category created
   * after this was written should start visible, not hidden because nobody
   * had opened it yet.
   */
  collapsedCategories: string[]

  setActiveOrganization: (organizationId: string | null) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setMobileNavOpen: (open: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  setProfileOpen: (open: boolean) => void
  setTheme: (theme: ThemePreference) => void
  toggleCategory: (categoryId: string) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeOrganizationId: null,
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandPaletteOpen: false,
      profileOpen: false,
      theme: 'dark',
      collapsedCategories: [],

      setActiveOrganization: (activeOrganizationId) => set({ activeOrganizationId }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      toggleCommandPalette: () =>
        set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
      // Opening the profile closes the drawer it may have been opened from:
      // two stacked overlays is one more than anyone needs.
      setProfileOpen: (profileOpen) =>
        set(profileOpen ? { profileOpen, mobileNavOpen: false } : { profileOpen }),
      setTheme: (theme) => set({ theme }),
      toggleCategory: (categoryId) =>
        set((state) => ({
          collapsedCategories: state.collapsedCategories.includes(categoryId)
            ? state.collapsedCategories.filter((id) => id !== categoryId)
            : [...state.collapsedCategories, categoryId],
        })),
    }),
    {
      name: 'lfg-hq-ui',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // Transient state must not survive a restart: nobody wants to reopen the
      // app to a command palette they closed yesterday.
      partialize: (state) => ({
        activeOrganizationId: state.activeOrganizationId,
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        collapsedCategories: state.collapsedCategories,
      }),
    },
  ),
)
