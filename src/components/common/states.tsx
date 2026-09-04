import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Lock, RefreshCw, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toAppError } from '@/lib/errors'
import { cn } from '@/lib/utils'

/**
 * The four states every data-backed surface must handle: loading, empty,
 * error and forbidden. Centralised so no screen can quietly render a blank div.
 */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'border-border flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center',
        className,
      )}
    >
      {Icon ? (
        <div className="bg-muted flex size-9 items-center justify-center rounded-md">
          <Icon className="text-muted-foreground size-4" aria-hidden="true" />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="text-muted-foreground mx-auto max-w-sm text-xs leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  const appError = toAppError(error)
  const isOffline = appError.kind === 'network'
  const Icon = isOffline ? WifiOff : appError.kind === 'forbidden' ? Lock : AlertTriangle

  return (
    <div
      role="alert"
      className={cn(
        'border-border bg-surface flex flex-col items-center justify-center gap-3 rounded-lg border px-6 py-10 text-center',
        className,
      )}
    >
      <div className="bg-destructive/10 flex size-9 items-center justify-center rounded-md">
        <Icon className="text-destructive size-4" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {isOffline ? 'You are offline' : 'Something went wrong'}
        </p>
        <p className="text-muted-foreground mx-auto max-w-sm text-xs leading-relaxed">
          {appError.userMessage}
        </p>
      </div>
      {onRetry && appError.retryable ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  )
}

export function ForbiddenState({ description }: { description?: string }) {
  return (
    <EmptyState
      icon={Lock}
      title="You do not have access to this"
      description={
        description ?? 'Your role does not include this area. Ask an admin if you need access.'
      }
    />
  )
}

/** Row-shaped skeleton for lists that load into a table or member list. */
export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="border-border flex items-center gap-3 rounded-md border p-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-48" />
          </div>
          <Skeleton className="h-5 w-16 rounded-sm" />
        </div>
      ))}
    </div>
  )
}

/** Card-shaped skeleton for dashboard widgets. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-3', index === lines - 1 ? 'w-1/2' : 'w-full')} />
      ))}
    </div>
  )
}
