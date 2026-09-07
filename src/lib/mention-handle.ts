/**
 * What the autocomplete may offer as a handle.
 *
 * A mention is resolved in Postgres, by a trigger that scans the body for
 * `@([A-Za-z0-9._-]{2,40})` and looks the capture up against a display name or
 * an email's local part. The parser is the constraint: a display name with a
 * space in it — "Adit si keren" — becomes `@Adit si keren` in the message, the
 * trigger captures `Adit`, matches nobody, and the mention silently does not
 * happen. The menu offered a handle the backend could never resolve.
 *
 * So the rule below is the parser's rule, restated on this side. It offers a
 * display name only when the *whole* name is something the trigger can
 * capture, and otherwise the email local part, which is the other thing the
 * trigger matches on. When neither can be captured there is no handle to
 * offer, and saying so is better than offering one that quietly fails.
 *
 * This changes nothing about the backend. The trigger, the schema, the RLS and
 * the notification path are all exactly as they were; what changes is that the
 * text this application inserts is text that one can read.
 */

/**
 * The trigger's own pattern, anchored.
 *
 * Anchored because the trigger captures a *run* of these characters out of a
 * longer string: "Adit si keren" contains a valid run and is not itself one,
 * and that difference is the entire bug.
 */
export const MENTION_HANDLE_PATTERN = /^[A-Za-z0-9._-]{2,40}$/

export function isResolvableHandle(value: string | null | undefined): boolean {
  return typeof value === 'string' && MENTION_HANDLE_PATTERN.test(value)
}

/**
 * The handle to offer for a person, or null when there is none to offer.
 *
 * Null is a real answer: somebody whose display name has a space and whose
 * email local part has a `+` in it cannot be mentioned by the current parser,
 * and belongs out of the menu rather than in it with a handle that does
 * nothing.
 */
export function mentionHandleFor(profile: {
  displayName?: string | null
  email?: string | null
}): string | null {
  if (isResolvableHandle(profile.displayName)) return profile.displayName as string

  // Not sanitised, because the trigger compares against the local part
  // exactly as it is stored. A cleaned-up version would match nobody.
  const local = (profile.email ?? '').split('@')[0] ?? ''
  return isResolvableHandle(local) ? local : null
}
