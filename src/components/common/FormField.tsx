import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Label + control + error, wired together for screen readers.
 *
 * Uses render-props so it works with any control while guaranteeing the
 * `id`/`aria-describedby`/`aria-invalid` triangle is correct — the part that
 * is easy to forget and invisible when it is wrong.
 */
export function FormField({
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string
  error?: string | undefined
  hint?: string
  required?: boolean
  className?: string
  children: (props: {
    id: string
    'aria-invalid': boolean
    'aria-describedby': string | undefined
  }) => React.ReactNode
}) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-destructive ml-0.5" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>

      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy || undefined,
      })}

      {hint && !error ? (
        <p id={hintId} className="text-2xs text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-2xs text-destructive font-medium">
          {error}
        </p>
      ) : null}
    </div>
  )
}
