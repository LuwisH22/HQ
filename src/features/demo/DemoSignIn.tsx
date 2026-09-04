import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'
import { isDemoModeAvailable } from '@/lib/demo-mode'

/**
 * The development entry point.
 *
 * Signs in as the seeded Owner so every implemented screen is reachable without
 * a Supabase project. It renders only when `isDemoModeAvailable()` is true,
 * which is a compile-time `false` in production builds.
 *
 * This is not an authentication mechanism: there is no credential to check and
 * nothing is verified. It exists so Phase 1 can be exercised locally.
 */
export function DemoSignIn({ standalone = false }: { standalone?: boolean }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  if (!isDemoModeAvailable()) return null

  async function enterDemo() {
    setBusy(true)
    try {
      const { signInAsDemoAdmin } = await import('@/services/demo')
      await signInAsDemoAdmin()
      void navigate('/', { replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={standalone ? '' : 'border-border mt-5 border-t pt-5'}>
      <div className="border-warning/30 bg-warning/10 space-y-3 rounded-md border p-3">
        <div className="flex items-start gap-2.5">
          <FlaskConical className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-warning text-2xs font-semibold tracking-wide uppercase">
              Development mode
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Explore the app with local sample data. Nothing is sent anywhere, and this option does
              not exist in a production build.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          loading={busy}
          onClick={() => void enterDemo()}
        >
          Continue as Demo Admin
        </Button>
      </div>
    </div>
  )
}
