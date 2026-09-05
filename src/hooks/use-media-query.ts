import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether a CSS media query currently matches.
 *
 * Tailwind handles almost everything responsive without JavaScript needing to
 * know the viewport. This is for the cases where the *behaviour* differs and
 * not just the styling — a side panel on a wide screen and a sheet on a phone
 * are two different controls, and one flag cannot describe both.
 *
 * Built on `useSyncExternalStore` rather than an effect: the value is read
 * during render instead of after it, so the first paint is already right, and
 * a viewport that changes between subscribing and reading cannot be missed.
 * `resize` is watched alongside the query's own event because dragging a
 * window across the breakpoint does not always announce itself as one.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      window.addEventListener('resize', onChange)
      return () => {
        list.removeEventListener('change', onChange)
        window.removeEventListener('resize', onChange)
      }
    },
    [query],
  )

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  // Server rendering has no viewport; the wide layout is the safer guess for
  // a build that never runs there anyway.
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}

/** Tailwind's `md` breakpoint, where the sidebar and side panels appear. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)')
}
