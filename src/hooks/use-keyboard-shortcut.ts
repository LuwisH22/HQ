import { useEffect, useRef } from 'react'

export interface ShortcutDefinition {
  /** Single character or a `KeyboardEvent.key` value such as `Escape`. */
  key: string
  /** Ctrl on Windows/Linux, ⌘ on macOS. */
  mod?: boolean
  shift?: boolean
  alt?: boolean
  /**
   * Whether the shortcut should still fire while a text field has focus.
   * Off by default so typing "k" in the message box never opens search.
   */
  allowInInput?: boolean
  /** Set false to temporarily disable without changing hook order. */
  enabled?: boolean
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return EDITABLE_TAGS.has(target.tagName) || target.isContentEditable
}

/**
 * Registers a global keyboard shortcut.
 *
 * The handler is kept in a ref so a new inline closure on every render does not
 * detach and re-attach the listener — which would drop keypresses on a busy
 * screen.
 */
export function useKeyboardShortcut(
  definition: ShortcutDefinition,
  handler: (event: KeyboardEvent) => void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  const {
    key,
    mod = false,
    shift = false,
    alt = false,
    allowInInput = false,
    enabled = true,
  } = definition

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== key.toLowerCase()) return

      // metaKey covers ⌘ on macOS, ctrlKey covers Windows and Linux.
      const modPressed = event.metaKey || event.ctrlKey
      if (mod !== modPressed) return
      if (shift !== event.shiftKey) return
      if (alt !== event.altKey) return
      if (!allowInInput && isEditableTarget(event.target)) return

      event.preventDefault()
      handlerRef.current(event)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key, mod, shift, alt, allowInInput, enabled])
}
