/**
 * Production stand-in for the demo-mode UI.
 *
 * Aliased in by `vite.config.ts` for every non-development build. Both entry
 * points render nothing, so a shipped application carries no trace of demo
 * mode — not the entry button, not the banner, not their copy.
 *
 * The signatures mirror the real components so the swap is type-checked.
 */

export function DemoSignIn(_props: { standalone?: boolean }): null {
  return null
}

export function DemoModeBanner(): null {
  return null
}
