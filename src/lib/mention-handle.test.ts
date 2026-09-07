import { describe, expect, it } from 'vitest'
import { isResolvableHandle, MENTION_HANDLE_PATTERN, mentionHandleFor } from './mention-handle'

/**
 * The handle the menu is allowed to insert.
 *
 * A mention only happens if a Postgres trigger can capture it out of the body
 * with `@([A-Za-z0-9._-]{2,40})` and match it against a display name or an
 * email local part. Offering "Adit si keren" as a handle produced
 * `@Adit si keren`, of which the trigger saw `Adit`, and the mention silently
 * did not happen. These are the cases that rule has to get right.
 */

const handleFor = (displayName: string | null, email = 'someone@example.com') =>
  mentionHandleFor({ displayName, email })

describe('a display name the parser can capture whole', () => {
  it('is used as it is', () => {
    expect(handleFor('Adit')).toBe('Adit')
  })

  it('keeps the characters the pattern allows', () => {
    expect(handleFor('Adit_123')).toBe('Adit_123')
    expect(handleFor('adit.keren')).toBe('adit.keren')
    expect(handleFor('adit-keren')).toBe('adit-keren')
    expect(handleFor('AD1T')).toBe('AD1T')
  })

  it('takes one exactly at each end of the length rule', () => {
    expect(handleFor('ab')).toBe('ab')
    expect(handleFor('a'.repeat(40))).toBe('a'.repeat(40))
  })
})

describe('a display name the parser would cut short', () => {
  it('falls back to the email local part when there is a space', () => {
    // The bug, exactly: the trigger would have captured "Adit" and matched
    // nobody, because nobody is called "Adit".
    expect(handleFor('Adit si keren', 'adit@lfg.gg')).toBe('adit')
  })

  it('falls back for characters the pattern does not allow', () => {
    for (const name of ['Adit!', 'Adit?', 'a@b', 'Adit+1', 'Adit/keren', 'Ádit', '名前']) {
      expect(handleFor(name, 'adit@lfg.gg')).toBe('adit')
    }
  })

  it('falls back for a name too short or too long to be captured', () => {
    expect(handleFor('A', 'adit@lfg.gg')).toBe('adit')
    expect(handleFor('a'.repeat(41), 'adit@lfg.gg')).toBe('adit')
  })

  it('falls back when there is no display name at all', () => {
    expect(handleFor(null, 'adit@lfg.gg')).toBe('adit')
    expect(handleFor('', 'adit@lfg.gg')).toBe('adit')
  })

  it('uses the local part exactly as it is stored', () => {
    // The trigger compares against split_part(email, '@', 1) verbatim, so a
    // tidied-up version would match nobody.
    expect(handleFor('Adit si keren', 'Adit.Keren@lfg.gg')).toBe('Adit.Keren')
  })
})

describe('when there is no handle to offer', () => {
  it('says so rather than offering one that cannot work', () => {
    // A name with a space and a local part with a plus: the parser can
    // capture neither, so this person cannot be mentioned by the current
    // backend and belongs out of the menu.
    expect(handleFor('Adit si keren', 'adit+hq@lfg.gg')).toBeNull()
    expect(handleFor(null, 'a@lfg.gg')).toBeNull()
    expect(handleFor(null, null as unknown as string)).toBeNull()
  })
})

describe('the pattern itself', () => {
  it('is anchored, which is the whole difference', () => {
    // The trigger captures a run out of a longer string. Testing that a name
    // *contains* a valid run is what produced the bug; it has to *be* one.
    expect(MENTION_HANDLE_PATTERN.test('Adit si keren')).toBe(false)
    expect(/[A-Za-z0-9._-]{2,40}/.test('Adit si keren')).toBe(true)
  })

  it('agrees with isResolvableHandle', () => {
    expect(isResolvableHandle('Adit')).toBe(true)
    expect(isResolvableHandle('Adit si keren')).toBe(false)
    expect(isResolvableHandle('')).toBe(false)
    expect(isResolvableHandle(null)).toBe(false)
    expect(isResolvableHandle(undefined)).toBe(false)
  })
})
