import { describe, expect, it } from 'vitest'
import { isTypingTarget } from './voice.service'

/**
 * The rule that keeps push-to-talk out of the way.
 *
 * A key held to talk must never be a key taken from somebody writing a
 * message. This is the whole of that decision, stated where it can be checked
 * without a room, a microphone or a media server.
 */

function make(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host.firstElementChild as HTMLElement
}

describe('is somebody typing here', () => {
  it('leaves the key alone in the places text goes', () => {
    expect(isTypingTarget(make('<input type="text" />'))).toBe(true)
    expect(isTypingTarget(make('<textarea></textarea>'))).toBe(true)
    expect(isTypingTarget(make('<select><option>a</option></select>'))).toBe(true)
    expect(isTypingTarget(make('<div contenteditable="true">words</div>'))).toBe(true)
    expect(isTypingTarget(make('<div contenteditable="">words</div>'))).toBe(true)
  })

  it('counts a child of one of them too', () => {
    // The caret can be inside a span inside a rich editor, and the event
    // target is the span.
    const editable = make('<div contenteditable="true"><span>deep</span></div>')
    expect(isTypingTarget(editable.querySelector('span'))).toBe(true)
  })

  it('takes the key everywhere else', () => {
    expect(isTypingTarget(make('<div>just a page</div>'))).toBe(false)
    expect(isTypingTarget(make('<button>press</button>'))).toBe(false)
    expect(isTypingTarget(document.body)).toBe(false)
  })

  it('says no rather than throwing when there is no element at all', () => {
    // window is an EventTarget and has no closest(); a blurred page sends
    // key events with no element behind them.
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(window)).toBe(false)
  })

  it('does not treat a range input as somewhere to type', () => {
    // A volume slider is an input, and Space on a focused slider is the
    // browser's business rather than the microphone's.
    expect(isTypingTarget(make('<input type="range" />'))).toBe(true)
  })
})
