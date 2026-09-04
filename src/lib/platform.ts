/**
 * Platform detection and the thin bridge to native desktop capabilities.
 *
 * Every Tauri API here is imported dynamically. That keeps the Tauri runtime
 * out of the web/PWA bundle entirely, and means a browser build never pays for
 * code it cannot use.
 */

export type Platform = 'desktop' | 'web'

interface TauriGlobal {
  __TAURI_INTERNALS__?: unknown
}

/** True when running inside the Tauri webview rather than a browser. */
export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in (window as unknown as TauriGlobal)
}

export function getPlatform(): Platform {
  return isDesktop() ? 'desktop' : 'web'
}

/** True when the PWA is running installed rather than in a browser tab. */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari predates the standard.
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

/** True on coarse-pointer devices, used to pick touch-sized affordances. */
export function isTouchPrimary(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(pointer: coarse)').matches
}

/** macOS uses ⌘ where Windows and Linux use Ctrl. */
export function isAppleKeyboard(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}

export const modifierKeyLabel = (): string => (isAppleKeyboard() ? '⌘' : 'Ctrl')

// --- Native notifications --------------------------------------------------

export interface NativeNotification {
  title: string
  body: string
}

/**
 * Raise an OS notification, preferring the Tauri plugin on desktop and falling
 * back to the Web Notification API in the browser. Silently no-ops when
 * permission is absent — notifications are a nicety, never a hard dependency.
 */
export async function showNativeNotification(notification: NativeNotification): Promise<void> {
  try {
    if (isDesktop()) {
      const { isPermissionGranted, requestPermission, sendNotification } =
        await import('@tauri-apps/plugin-notification')
      let granted = await isPermissionGranted()
      if (!granted) {
        granted = (await requestPermission()) === 'granted'
      }
      if (granted) sendNotification(notification)
      return
    }

    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'granted') {
      new Notification(notification.title, { body: notification.body, icon: '/icons/icon-192.png' })
    }
  } catch (error) {
    console.warn('Native notification unavailable', error)
  }
}

/** Ask for notification permission. Returns whether it was granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (isDesktop()) {
      const { isPermissionGranted, requestPermission } =
        await import('@tauri-apps/plugin-notification')
      return (await isPermissionGranted()) || (await requestPermission()) === 'granted'
    }
    if (typeof Notification === 'undefined') return false
    if (Notification.permission === 'granted') return true
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

/** Whether the app window currently has OS focus. */
export async function isWindowFocused(): Promise<boolean> {
  if (!isDesktop()) return typeof document !== 'undefined' && document.hasFocus()
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<boolean>('window_is_focused')
  } catch {
    return true
  }
}

/** Bring the app window to the front, e.g. from a notification click. */
export async function focusAppWindow(): Promise<void> {
  if (!isDesktop()) {
    window.focus()
    return
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('focus_window')
  } catch (error) {
    console.warn('Could not focus the window', error)
  }
}

/**
 * Open a URL in the user's real browser. Inside the desktop shell, navigating
 * the webview to an external site would replace the app, so external links
 * must be handed to the OS.
 */
export async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url, window.location.href)
  if (
    parsed.protocol !== 'https:' &&
    parsed.protocol !== 'http:' &&
    parsed.protocol !== 'mailto:'
  ) {
    throw new Error(`Refusing to open unsupported protocol: ${parsed.protocol}`)
  }

  if (isDesktop()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(parsed.toString())
    return
  }
  window.open(parsed.toString(), '_blank', 'noopener,noreferrer')
}
