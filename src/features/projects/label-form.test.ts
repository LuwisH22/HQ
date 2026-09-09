import { describe, expect, it } from 'vitest'
import { defaultsForNewLabel, isNameSendable, labelSchema, toLabelInput } from './label-form'
import {
  LABEL_BADGE_VARIANT,
  LABEL_COLORS,
  LABEL_COLOR_LABELS,
  LABEL_DOT_TONE,
} from './label-colors'

/**
 * What a label may be.
 *
 * The colours are the point: six tokens, matching the CHECK constraint in
 * 20250920004700 exactly. If this list and that one ever drift, a label a
 * person can choose becomes a label the database refuses.
 */

describe('the colours a label may be', () => {
  it('are the six the database accepts, and no others', () => {
    expect(LABEL_COLORS).toEqual(['violet', 'brass', 'success', 'warning', 'danger', 'neutral'])
  })

  it('all have a name, a badge and a mark', () => {
    for (const color of LABEL_COLORS) {
      expect(LABEL_COLOR_LABELS[color]).toBeTruthy()
      expect(LABEL_BADGE_VARIANT[color]).toBeTruthy()
      expect(LABEL_DOT_TONE[color]).toBeTruthy()
    }
  })

  it('are tokens rather than anything a stylesheet could be injected through', () => {
    for (const color of LABEL_COLORS) {
      expect(color).toMatch(/^[a-z]+$/)
    }
    // Anything else is refused before it reaches the database.
    expect(labelSchema.safeParse({ name: 'X', color: '#ff0000', description: '' }).success).toBe(
      false,
    )
    expect(
      labelSchema.safeParse({ name: 'X', color: 'url(javascript:alert(1))', description: '' })
        .success,
    ).toBe(false)
  })
})

describe('naming a label', () => {
  const values = (overrides: Partial<{ name: string; description: string }> = {}) => ({
    ...defaultsForNewLabel(),
    name: 'Scrim',
    ...overrides,
  })

  it('accepts an ordinary one', () => {
    expect(labelSchema.safeParse(values()).success).toBe(true)
  })

  it('will not take an empty name', () => {
    const parsed = labelSchema.safeParse(values({ name: '   ' }))
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe('A label needs a name')
  })

  it('will not take one longer than the column', () => {
    expect(labelSchema.safeParse(values({ name: 'x'.repeat(41) })).success).toBe(false)
    expect(labelSchema.safeParse(values({ name: 'x'.repeat(40) })).success).toBe(true)
  })

  it('will not take a description longer than the column', () => {
    expect(labelSchema.safeParse(values({ description: 'x'.repeat(201) })).success).toBe(false)
    expect(labelSchema.safeParse(values({ description: 'x'.repeat(200) })).success).toBe(true)
  })

  it('starts new labels neutral and unnamed', () => {
    expect(defaultsForNewLabel()).toEqual({ name: '', color: 'neutral', description: '' })
  })

  it('trims what it sends, and sends nothing rather than an empty description', () => {
    const input = toLabelInput(values({ name: '  Scrim  ', description: '  ' }))
    expect(input.name).toBe('Scrim')
    expect(input.description).toBeNull()
  })

  it('knows which typed names are worth sending', () => {
    expect(isNameSendable('  ')).toBe(false)
    expect(isNameSendable('Scrim')).toBe(true)
    expect(isNameSendable('x'.repeat(41))).toBe(false)
  })
})
