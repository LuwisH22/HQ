/**
 * What a quote of a message says.
 *
 * Pure, and separate from the component that draws it, the way the mention
 * and attachment helpers are: the rule about what a preview contains is worth
 * testing on its own, without a DOM.
 */

/** Long enough for a line at any width, short enough not to ship a novel. */
export const PREVIEW_LIMIT = 160

/**
 * One line of a message, for the row above a reply.
 *
 * Whitespace is collapsed because a quote is a single glance: a body's own
 * line breaks would otherwise decide the height of the row. The result is
 * plain text and is rendered as plain text — there is no path here for markup
 * of any kind.
 */
export function replyPreviewOf(body: string): string {
  const flat = body.replace(/\s+/gu, ' ').trim()
  return flat.length > PREVIEW_LIMIT ? `${flat.slice(0, PREVIEW_LIMIT)}…` : flat
}
