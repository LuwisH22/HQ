/**
 * Helpers shared by the service layer.
 */

/**
 * Narrows a PostgREST embedded relation to a single record.
 *
 * A to-one embed comes back as an object, but different supabase-js versions
 * have typed it as `T`, `T | null` or `T[]`. Funnelling every embed through one
 * explicitly-generic helper keeps that variance in a single place — and avoids
 * `Array.isArray()` narrowing an object type to `never` at the call site, which
 * silently degrades the result to `any`.
 */
export function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}
