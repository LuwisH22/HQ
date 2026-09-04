import { AlertTriangle } from 'lucide-react'

/**
 * Shown when `VITE_SUPABASE_*` is missing or malformed.
 *
 * A misconfigured build would otherwise fail as a stream of opaque network
 * errors somewhere deep in the app; this fails loudly, once, with the fix.
 */
export function EnvironmentError({ errors }: { errors: string[] }) {
  return (
    <div className="bg-background flex min-h-dvh items-center justify-center p-6">
      <div className="border-border bg-surface w-full max-w-lg space-y-4 rounded-lg border p-6">
        <div className="flex items-center gap-3">
          <div className="bg-warning/15 flex size-9 shrink-0 items-center justify-center rounded-md">
            <AlertTriangle className="text-warning size-4" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">LFG HQ is not configured</h1>
            <p className="text-2xs text-muted-foreground">
              The app cannot reach a backend until these are set.
            </p>
          </div>
        </div>

        <ul className="border-border bg-elevated space-y-1.5 rounded-md border p-3">
          {errors.map((error) => (
            <li key={error} className="text-2xs text-destructive font-mono leading-relaxed">
              {error}
            </li>
          ))}
        </ul>

        <div className="text-muted-foreground space-y-2 text-xs leading-relaxed">
          <p>
            Copy <code className="text-foreground font-mono">.env.example</code> to{' '}
            <code className="text-foreground font-mono">.env</code>, fill in your Supabase project
            URL and anon key, then restart the dev server.
          </p>
          <p className="text-2xs">
            Only the anon key belongs in this file. The service-role key must never be given a{' '}
            <code className="font-mono">VITE_</code> prefix — anything prefixed that way is compiled
            into the client and visible to anyone who has the app.
          </p>
        </div>
      </div>
    </div>
  )
}
