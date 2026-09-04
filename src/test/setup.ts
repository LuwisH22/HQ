import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, vi } from 'vitest'

// Vite exposes these through import.meta.env; tests need them defined before
// any module that validates the environment is imported.
beforeAll(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key-not-a-real-credential')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// jsdom implements neither, and both are used by the layout and theme code.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }),
})

window.HTMLElement.prototype.scrollIntoView = vi.fn()
