import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
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
