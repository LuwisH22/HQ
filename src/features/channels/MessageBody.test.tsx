import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { MessageMention } from '@/services/message.service'
import { MessageBody } from './MessageBody'

/**
 * What a message body turns into.
 *
 * The paragraph is `whitespace-pre-wrap`, so every character it contains is a
 * character the reader sees: a stray space between two segments is a visible
 * gap, and a stray newline is a blank line. That makes "the text out is the
 * text in, exactly" the thing worth asserting, alongside how many spans the
 * highlighting actually produced.
 */

const AGER: MessageMention = { userId: 'u-ager', handle: 'ager' }
const RILEY: MessageMention = { userId: 'u-riley', handle: 'riley' }

function body(text: string, mentions: MessageMention[] = [], currentUserId: string | null = null) {
  const { container } = render(
    <MessageBody body={text} mentions={mentions} currentUserId={currentUserId} edited={false} />,
  )
  const paragraph = container.querySelector('p')
  if (!paragraph) throw new Error('no paragraph rendered')
  return {
    text: paragraph.textContent,
    highlighted: [...paragraph.querySelectorAll('[data-mention]')].map((el) => el.textContent),
    breaks: paragraph.querySelectorAll('br').length,
    html: paragraph.innerHTML,
  }
}

describe('a body that is nothing but a mention', () => {
  it('renders it exactly once', () => {
    const rendered = body('@AGER', [AGER])
    expect(rendered.highlighted).toEqual(['@AGER'])
    // Not '@AGER@AGER': the highlighted span replaces the text, it does not
    // accompany it.
    expect(rendered.text).toBe('@AGER')
  })

  it('adds nothing around it', () => {
    // No wrapper, no separator, nothing that `whitespace-pre-wrap` would show
    // as an extra line or an extra space.
    expect(body('@AGER', [AGER]).html).toBe(
      '<span data-mention="other" class="text-accent-text font-medium">@AGER</span>',
    )
  })
})

describe('a mention inside a sentence', () => {
  it('keeps the sentence as one run of text', () => {
    const rendered = body('hello @AGER', [AGER])
    expect(rendered.text).toBe('hello @AGER')
    expect(rendered.breaks).toBe(0)
    expect(rendered.highlighted).toEqual(['@AGER'])
  })

  it('keeps what comes after it', () => {
    const rendered = body('hello @AGER, scrim at 8?', [AGER])
    expect(rendered.text).toBe('hello @AGER, scrim at 8?')
    expect(rendered.highlighted).toEqual(['@AGER'])
  })

  it('highlights every person named', () => {
    const rendered = body('@AGER and @riley, ready?', [AGER, RILEY])
    expect(rendered.text).toBe('@AGER and @riley, ready?')
    expect(rendered.highlighted).toEqual(['@AGER', '@riley'])
  })

  it('names the same person once per span, not once per row', () => {
    const rendered = body('@AGER @AGER', [AGER])
    expect(rendered.text).toBe('@AGER @AGER')
    expect(rendered.highlighted).toEqual(['@AGER', '@AGER'])
  })
})

describe('text that only looks like a mention', () => {
  it('leaves a handle nobody holds alone', () => {
    const rendered = body('ping @nobodyatall please', [])
    expect(rendered.text).toBe('ping @nobodyatall please')
    expect(rendered.highlighted).toEqual([])
  })

  it('leaves an address alone even when the local part is a member', () => {
    // The database recorded nothing for it, so neither does the rendering.
    const rendered = body('mail riley@lfg.gg', [])
    expect(rendered.highlighted).toEqual([])
  })
})

describe('newlines', () => {
  it('keeps every one of them, in a body with no mentions', () => {
    const rendered = body('one\ntwo\n\nfour')
    expect(rendered.text).toBe('one\ntwo\n\nfour')
    expect(rendered.breaks).toBe(0)
  })

  it('keeps them around a mention too', () => {
    const rendered = body('one\n@AGER\n\nfour', [AGER])
    expect(rendered.text).toBe('one\n@AGER\n\nfour')
    expect(rendered.highlighted).toEqual(['@AGER'])
  })
})

describe('being the one named', () => {
  it('reads differently when the mention is of you', () => {
    const { container } = render(
      <MessageBody body="@AGER" mentions={[AGER]} currentUserId="u-ager" edited={false} />,
    )
    expect(container.querySelector('[data-mention]')?.getAttribute('data-mention')).toBe('self')
  })
})

describe('an edited message', () => {
  it('says so after the words, on the same line', () => {
    const { container } = render(
      <MessageBody body="hello @AGER" mentions={[AGER]} currentUserId={null} edited />,
    )
    const paragraph = container.querySelector('p')
    expect(paragraph?.textContent).toBe('hello @AGER (edited)')
    expect(paragraph?.querySelectorAll('br')).toHaveLength(0)
  })
})
