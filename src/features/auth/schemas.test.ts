import { describe, expect, it } from 'vitest'
import { inviteSchema, resetPasswordSchema, signInSchema } from './schemas'

describe('signInSchema', () => {
  it('normalises the email to lowercase and trims it', () => {
    const result = signInSchema.parse({ email: '  Owner@LFG.TEST  ', password: 'secret' })
    expect(result.email).toBe('owner@lfg.test')
  })

  it('rejects a malformed address', () => {
    expect(signInSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false)
  })

  it('requires a password but does not impose length rules on sign-in', () => {
    // Length is enforced when *setting* a password; rejecting a short one here
    // would tell an attacker the stored password is longer than what they tried.
    expect(signInSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true)
    expect(signInSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false)
  })
})

describe('resetPasswordSchema', () => {
  it('accepts a matching pair of long-enough passwords', () => {
    const values = { password: 'correct-horse-battery', confirmPassword: 'correct-horse-battery' }
    expect(resetPasswordSchema.safeParse(values).success).toBe(true)
  })

  it('rejects passwords under ten characters', () => {
    const result = resetPasswordSchema.safeParse({ password: 'short', confirmPassword: 'short' })
    expect(result.success).toBe(false)
  })

  it('reports a mismatch against the confirmation field', () => {
    const result = resetPasswordSchema.safeParse({
      password: 'correct-horse-battery',
      confirmPassword: 'correct-horse-batter',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['confirmPassword'])
    }
  })
})

describe('inviteSchema', () => {
  it('requires a uuid role id', () => {
    expect(inviteSchema.safeParse({ email: 'new@lfg.test', roleId: 'player' }).success).toBe(false)
    expect(
      inviteSchema.safeParse({
        email: 'new@lfg.test',
        roleId: '3f0f9d3a-9b0e-4d3f-9a1e-2c4b6d8e0f11',
      }).success,
    ).toBe(true)
  })
})
