import { WarningCircle } from '@phosphor-icons/react'
import { errorMessage } from '@/lib/errors'

/**
 * Why a write did not happen, in words a person can act on.
 *
 * `errorMessage` is the application's one mapping from a Postgres or PostgREST
 * failure to a sentence; nothing here ever renders a raw error. Shown inside
 * the dialog that failed, so the form stays open with what was typed still in
 * it.
 */
export function FormFailure({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null

  return (
    <p
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-sm border px-3 py-2 text-xs"
    >
      <WarningCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{errorMessage(error)}</span>
    </p>
  )
}
