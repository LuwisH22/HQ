import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Error normalisation.
 *
 * Two rules drive this file:
 *   1. Users never see a Postgres error string. They see a sentence.
 *   2. We never leak schema details, constraint names or row counts into the
 *      UI, because those are a reconnaissance aid for anyone poking at the app.
 *
 * The original error is kept on `cause` for the console and for Sentry.
 */

export type AppErrorKind =
  | 'network'
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'server'
  | 'unknown'

export class AppError extends Error {
  readonly kind: AppErrorKind
  /** Safe to render verbatim in the UI. */
  readonly userMessage: string
  readonly retryable: boolean

  constructor(
    kind: AppErrorKind,
    userMessage: string,
    options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(userMessage, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AppError'
    this.kind = kind
    this.userMessage = userMessage
    this.retryable = options.retryable ?? (kind === 'network' || kind === 'server')
  }
}

/** Postgres SQLSTATE codes the schema raises deliberately. */
const PG_CODE_MAP: Record<string, { kind: AppErrorKind; message: string }> = {
  '42501': { kind: 'forbidden', message: 'You do not have permission to do that.' },
  '23505': { kind: 'conflict', message: 'That already exists.' },
  '23503': { kind: 'validation', message: 'That references something which no longer exists.' },
  '23514': { kind: 'validation', message: 'That change is not allowed.' },
  '22001': { kind: 'validation', message: 'One of the values is too long.' },
  P0002: { kind: 'not_found', message: 'We could not find that.' },
  PGRST301: { kind: 'auth', message: 'Your session has expired. Please sign in again.' },
}

function isPostgrestError(value: unknown): value is PostgrestError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    ('code' in value || 'details' in value)
  )
}

/**
 * `RAISE EXCEPTION ... USING errcode` messages are written by us, for users, so
 * they are safe to surface. Anything longer or containing SQL punctuation is
 * treated as an internal detail and replaced.
 */
function isAuthoredMessage(message: string): boolean {
  return (
    message.length > 0 &&
    message.length <= 160 &&
    !/[{}<>]|::|\bselect\b|\brelation\b|\bcolumn\b/i.test(message)
  )
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new AppError('network', 'You appear to be offline. Check your connection.', {
      cause: error,
      retryable: true,
    })
  }

  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return new AppError('network', 'Could not reach the server. Please try again.', {
      cause: error,
      retryable: true,
    })
  }

  if (isPostgrestError(error)) {
    const mapped = error.code ? PG_CODE_MAP[error.code] : undefined
    if (mapped) {
      // Prefer our own RAISE EXCEPTION text when there is one — it is more
      // specific than the generic mapping.
      const message =
        error.code === '42501' && isAuthoredMessage(error.message) ? error.message : mapped.message
      return new AppError(mapped.kind, message, { cause: error })
    }
    if (isAuthoredMessage(error.message)) {
      return new AppError('validation', error.message, { cause: error })
    }
    return new AppError('server', 'Something went wrong on our side. Please try again.', {
      cause: error,
      retryable: true,
    })
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number(error.status)
    const message =
      'message' in error && typeof (error as { message: unknown }).message === 'string'
        ? (error as { message: string }).message
        : ''

    if (status === 401 || status === 403) {
      return new AppError(
        status === 401 ? 'auth' : 'forbidden',
        status === 401
          ? 'Your session has expired. Please sign in again.'
          : 'You do not have permission to do that.',
        { cause: error },
      )
    }
    if (status === 404)
      return new AppError('not_found', 'We could not find that.', { cause: error })
    if (status === 409) return new AppError('conflict', 'That already exists.', { cause: error })
    if (status === 422 && isAuthoredMessage(message)) {
      return new AppError('validation', message, { cause: error })
    }
    if (status === 429) {
      return new AppError('rate_limited', 'Too many attempts. Please wait a moment.', {
        cause: error,
      })
    }
    if (status >= 500) {
      return new AppError('server', 'The server is having trouble. Please try again.', {
        cause: error,
        retryable: true,
      })
    }
  }

  if (error instanceof Error && isAuthoredMessage(error.message)) {
    return new AppError('unknown', error.message, { cause: error })
  }

  return new AppError('unknown', 'Something went wrong. Please try again.', { cause: error })
}

/** Convenience for toasts and inline messages. */
export function errorMessage(error: unknown): string {
  return toAppError(error).userMessage
}
