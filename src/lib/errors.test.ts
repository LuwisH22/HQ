import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError, errorMessage, toAppError } from './errors'

function pgError(code: string, message: string) {
  return { code, message, details: '', hint: '', name: 'PostgrestError' }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toAppError', () => {
  it('passes an AppError through untouched', () => {
    const original = new AppError('forbidden', 'Nope')
    expect(toAppError(original)).toBe(original)
  })

  it('maps insufficient_privilege to a forbidden error', () => {
    const error = toAppError(pgError('42501', 'permission denied for table messages'))
    expect(error.kind).toBe('forbidden')
    expect(error.retryable).toBe(false)
  })

  it('prefers our own RAISE EXCEPTION text over the generic message', () => {
    const error = toAppError(
      pgError('42501', 'Cannot grant a role with more authority than your own'),
    )
    expect(error.userMessage).toBe('Cannot grant a role with more authority than your own')
  })

  it('does not leak Postgres internals into the user message', () => {
    const error = toAppError(
      pgError('42501', 'permission denied for relation organization_members'),
    )
    expect(error.userMessage).toBe('You do not have permission to do that.')
    expect(error.userMessage).not.toContain('organization_members')
  })

  it('maps unique_violation to a conflict', () => {
    expect(toAppError(pgError('23505', 'duplicate key value')).kind).toBe('conflict')
  })

  it('replaces an unrecognised Postgres error with a generic server message', () => {
    const error = toAppError(pgError('XX000', 'internal error in relation foo column bar'))
    expect(error.kind).toBe('server')
    expect(error.userMessage).not.toContain('relation')
    expect(error.retryable).toBe(true)
  })

  it('detects being offline before anything else', () => {
    vi.stubGlobal('navigator', { onLine: false })
    const error = toAppError(pgError('42501', 'permission denied'))
    expect(error.kind).toBe('network')
    expect(error.retryable).toBe(true)
  })

  it('maps HTTP statuses', () => {
    vi.stubGlobal('navigator', { onLine: true })
    expect(toAppError({ status: 401, message: 'jwt expired' }).kind).toBe('auth')
    expect(toAppError({ status: 403, message: 'forbidden' }).kind).toBe('forbidden')
    expect(toAppError({ status: 404, message: 'not found' }).kind).toBe('not_found')
    expect(toAppError({ status: 429, message: 'slow down' }).kind).toBe('rate_limited')
    expect(toAppError({ status: 503, message: 'unavailable' }).kind).toBe('server')
  })

  it('treats a fetch TypeError as a network failure', () => {
    vi.stubGlobal('navigator', { onLine: true })
    const error = toAppError(new TypeError('Failed to fetch'))
    expect(error.kind).toBe('network')
  })

  it('falls back to a generic message for unknown values', () => {
    vi.stubGlobal('navigator', { onLine: true })
    const error = toAppError({ weird: true })
    expect(error.kind).toBe('unknown')
    expect(error.userMessage).toBe('Something went wrong. Please try again.')
  })

  it('keeps the original error as the cause for logging', () => {
    vi.stubGlobal('navigator', { onLine: true })
    const original = pgError('23505', 'duplicate key')
    expect(toAppError(original).cause).toBe(original)
  })
})

describe('errorMessage', () => {
  it('returns a user-safe string', () => {
    vi.stubGlobal('navigator', { onLine: true })
    expect(errorMessage(pgError('23505', 'duplicate key'))).toBe('That already exists.')
  })
})
