import { useEffect } from 'react'
import { router } from '@/routes/router'
import { isDesktop } from '@/lib/platform'
import { establishSessionFromDeepLink, parseAuthDeepLink } from './deep-link'
import { stashInviteToken } from './invite-token'

/**
 * Wires OS deep links into the router. Desktop only, mounted exactly once.
 *
 * The plugin surfaces two arrivals and both matter:
 *
 *   - cold start — the app was launched *by* the link, so the URL is already
 *     waiting in `getCurrent()` and no event will ever fire for it;
 *   - warm start — the app was running, so the URL arrives as a
 *     `deep-link://new-url` event, which `onOpenUrl` wraps.
 *
 * Handling only one of the two produces a bug that looks intermittent: the
 * link works when the app happens to be open and silently does nothing
 * otherwise.
 *
 * The Tauri import is dynamic so the web/PWA bundle never pulls it in, which
 * is the same rule `platform.ts` follows for every other native capability.
 */
export function useAuthDeepLinks(): void {
  useEffect(() => {
    if (!isDesktop()) return

    let cancelled = false
    let unlisten: (() => void) | null = null

    async function handle(raw: string): Promise<void> {
      const parsed = parseAuthDeepLink(raw)
      // Not an LFG HQ auth link. Any process on the machine can invoke the
      // scheme, so silence — not an error toast — is the right response.
      if (!parsed) return

      if (parsed.inviteToken) stashInviteToken(parsed.inviteToken)

      try {
        const route = await establishSessionFromDeepLink(parsed)
        if (cancelled) return
        await router.navigate(route, { replace: true })
      } catch {
        // A stale or already-used link. The destination route renders its own
        // "this link is no longer valid" state, which is more useful than a
        // toast over whatever happens to be on screen.
        if (!cancelled) await router.navigate(parsed.route, { replace: true })
      }
    }

    void (async () => {
      try {
        const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link')

        const launchUrls = await getCurrent()
        if (cancelled) return
        for (const url of launchUrls ?? []) await handle(url)

        if (cancelled) return
        unlisten = await onOpenUrl((urls) => {
          for (const url of urls) void handle(url)
        })
        // Unmounted while the listener was being registered.
        if (cancelled) {
          unlisten()
          unlisten = null
        }
      } catch {
        // The plugin is unavailable — an older shell, or a web build that
        // wrongly reported desktop. Deep links simply do not fire.
      }
    })()

    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  }, [])
}
