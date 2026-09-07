import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Must be evaluated before anything reads `window.location` — the router
// included — so the raw invitation token leaves the address bar before the
// first render and never reaches the history stack. Module bodies run in
// import order, which is why this sits above `./App`. See `invite-token.ts`
// for what this can and cannot protect against.
import './features/auth/capture-invite-token'
import { App } from './App'
// Self-hosted so the desktop build works offline and satisfies the Tauri CSP
// (font-src 'self'), which blocks Google Fonts.
//
// Blackout's three families: Archivo for display — the width axis is the
// expression, so the `wdth` build rather than the standard one — Geist for
// every piece of UI text, Geist Mono for metadata. Inter stays behind them as
// the fallback, so nothing reflows before the others arrive.
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/inter'
import './index.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element #root is missing from index.html')
}

// In a release desktop build, suppress the webview's own context menu — it
// offers "Reload" and "Inspect element" on what is meant to be an installed
// application. Left intact in development, where those are useful.
if ('__TAURI_INTERNALS__' in window && !import.meta.env.DEV) {
  document.addEventListener('contextmenu', (event) => {
    // Keep the native menu for text fields, where cut/copy/paste matters.
    const target = event.target
    if (target instanceof HTMLElement && target.closest('input, textarea')) return
    event.preventDefault()
  })
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
