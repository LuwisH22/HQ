import { describe, expect, it } from 'vitest'
import { applyMention, matchCandidates, mentionQueryAt } from './mentions'
import type { MentionCandidate } from '@/services/channel.service'

/**
 * What counts as a mention being typed.
 *
 * The fiddliest part of the feature and the easiest to get subtly wrong, so
 * it is pure and tested here rather than discovered through the interface.
 */

describe('recognising an @handle at the caret', () => {
  const at = (value: string) => mentionQueryAt(value, value.length)

  it('opens on a bare @', () => {
    expect(at('@')).toEqual({ start: 0, term: '' })
  })

  it('collects what follows it', () => {
    expect(at('yo @age')).toEqual({ start: 3, term: 'age' })
  })

  it('is case-insensitive in the term', () => {
    expect(at('@AGE')?.term).toBe('age')
  })

  it('ignores an @ in the middle of a word, which is an address', () => {
    expect(at('mail me at riley@lfg.gg')).toBeNull()
    expect(at('riley@lfg')).toBeNull()
  })

  it('stops at whitespace, so a finished mention does not keep matching', () => {
    expect(at('@ager cek ini')).toBeNull()
  })

  it('takes the last @ when there are several', () => {
    expect(at('@ager and @no')).toEqual({ start: 10, term: 'no' })
  })

  it('gives up on characters a handle cannot contain', () => {
    expect(at('@ager!')).toBeNull()
    expect(at('@50%')).toBeNull()
  })

  it('allows the punctuation a handle can contain', () => {
    expect(at('@ri.ley_v-1')?.term).toBe('ri.ley_v-1')
  })

  it('gives up once the term is longer than a handle can be', () => {
    expect(at(`@${'a'.repeat(41)}`)).toBeNull()
  })

  it('reads at the caret, not at the end of the line', () => {
    const value = 'yo @age cek ini'
    expect(mentionQueryAt(value, 7)).toEqual({ start: 3, term: 'age' })
    // Caret parked after the sentence: nothing is being typed.
    expect(mentionQueryAt(value, value.length)).toBeNull()
  })

  it('is closed when there is no caret', () => {
    expect(mentionQueryAt('@age', -1)).toBeNull()
  })
})

describe('inserting the chosen handle', () => {
  it('replaces the partial term and leaves a space to keep typing', () => {
    const value = 'yo @age'
    const query = mentionQueryAt(value, value.length)!
    expect(applyMention(value, query, 'Ager', value.length)).toEqual({
      value: 'yo @Ager ',
      caret: 9,
    })
  })

  it('keeps what was already after the caret', () => {
    const value = 'yo @age cek'
    const query = mentionQueryAt(value, 7)!
    expect(applyMention(value, query, 'Ager', 7).value).toBe('yo @Ager  cek')
  })

  it('supports a second mention in the same message', () => {
    const first = applyMention('@ag', mentionQueryAt('@ag', 3)!, 'Ager', 3)
    const typed = `${first.value}and @ri`
    const second = applyMention(typed, mentionQueryAt(typed, typed.length)!, 'Riley', typed.length)
    expect(second.value).toBe('@Ager and @Riley ')
  })
})

describe('narrowing the roster', () => {
  const roster: MentionCandidate[] = [
    { userId: '1', handle: 'Ager', displayName: 'Ager', avatarUrl: null, roleName: 'Player' },
    {
      userId: '2',
      handle: 'riley',
      displayName: 'Riley Vance',
      avatarUrl: null,
      roleName: 'Owner',
    },
    { userId: '3', handle: 'noorx', displayName: 'Noor', avatarUrl: null, roleName: 'Player' },
  ]

  it('offers everyone for a bare @', () => {
    expect(matchCandidates(roster, '')).toHaveLength(3)
  })

  it('matches on the handle', () => {
    expect(matchCandidates(roster, 'age').map((c) => c.handle)).toEqual(['Ager'])
  })

  it('matches on the display name too', () => {
    expect(matchCandidates(roster, 'vance').map((c) => c.handle)).toEqual(['riley'])
  })

  it('offers nobody when nothing matches', () => {
    expect(matchCandidates(roster, 'zzz')).toHaveLength(0)
  })

  it('caps the menu so it never grows taller than the composer', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...roster[0]!,
      userId: String(i),
      handle: `player${String(i)}`,
    }))
    expect(matchCandidates(many, '')).toHaveLength(8)
  })
})
