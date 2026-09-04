/**
 * Development demo-mode UI.
 *
 * Imported through this barrel so `vite.config.ts` can alias the whole module
 * to `index.prod.ts` in production builds, keeping the demo entry point and its
 * copy out of the shipped bundle. `scripts/assert-no-demo-code.mjs` enforces it.
 */
export { DemoSignIn } from './DemoSignIn'
export { DemoModeBanner } from './DemoModeBanner'
