import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /** Rendered instead of the default panel when provided. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence against a white screen.
 *
 * Render errors are caught here and shown as a recoverable panel. The shape of
 * `componentDidCatch` is also where a Sentry `captureException` goes when the
 * organization decides to enable it — no other code needs to change.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack)
  }

  private readonly reset = (): void => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <div
        role="alert"
        className="flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <div className="bg-destructive/10 flex size-10 items-center justify-center rounded-md">
          <AlertTriangle className="text-destructive size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">This section failed to load</h2>
          <p className="text-muted-foreground mx-auto max-w-md text-xs leading-relaxed">
            An unexpected error stopped this part of the app from rendering. The rest of LFG HQ is
            unaffected.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={this.reset}>
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>
      </div>
    )
  }
}
