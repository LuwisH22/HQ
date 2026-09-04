import { useEffect, useState } from 'react'

/**
 * Delays propagating a value until it has been stable for `delayMs`.
 * Used to keep search inputs from issuing a query per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
