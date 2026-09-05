import { describe, expect, it } from 'vitest'
import { PREVIEW_LIMIT, replyPreviewOf } from './replies'

/**
 * What a quote of a message says.
 *
 * The line above a reply is one glance: whatever the body did with its own
 * whitespace, the quote is a single line, and however long it ran, the quote
 * ends.
 */

describe('previewing a message', () => {
  it('keeps a short message exactly as it was', () => {
    expect(replyPreviewOf('hello')).toBe('hello')
  })

  it('flattens the line breaks a body is allowed to have', () => {
    expect(replyPreviewOf('first line\nsecond line')).toBe('first line second line')
    expect(replyPreviewOf('spaced    out')).toBe('spaced out')
    expect(replyPreviewOf('  padded  ')).toBe('padded')
  })

  it('ends a long message rather than running on', () => {
    const long = 'a'.repeat(PREVIEW_LIMIT + 40)
    const preview = replyPreviewOf(long)

    expect(preview).toHaveLength(PREVIEW_LIMIT + 1)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('takes one exactly at the limit whole', () => {
    const exact = 'b'.repeat(PREVIEW_LIMIT)
    expect(replyPreviewOf(exact)).toBe(exact)
  })

  it('has nothing to say about a deleted message', () => {
    // The body of a deleted message is empty; the line says so in words of
    // its own rather than quoting nothing.
    expect(replyPreviewOf('')).toBe('')
  })

  it('does not interpret what it is given', () => {
    // It goes into a span as text. Nothing here unescapes, and nothing
    // downstream parses.
    expect(replyPreviewOf('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
  })
})
