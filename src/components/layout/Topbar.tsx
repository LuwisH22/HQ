import { List, MagnifyingGlass, WifiSlash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useUiStore } from '@/stores/ui.store'
import { useConnectionStatus } from '@/hooks/use-connection-status'
import { modifierKeyLabel } from '@/lib/platform'
import { DemoModeBanner } from '@/features/demo'
import { cn } from '@/lib/utils'

/**
 * Slim application header.
 *
 * The window itself is the chrome on desktop, so this stays to one row: a
 * mobile menu button, the global search trigger, and the connection state.
 */
export function Topbar({ title }: { title?: string }) {
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const toggleCommandPalette = useUiStore((state) => state.toggleCommandPalette)
  const connection = useConnectionStatus()

  return (
    <header
      className={cn(
        'border-border bg-surface flex h-12 shrink-0 items-center gap-2 border-b px-3',
        // The empty area doubles as the window drag handle on desktop.
        'app-drag',
      )}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className="app-no-drag md:hidden"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open navigation"
      >
        <List aria-hidden="true" />
      </Button>

      {title ? <h1 className="truncate text-sm font-semibold tracking-tight">{title}</h1> : null}

      <div className="app-no-drag ml-auto flex items-center gap-2">
        <DemoModeBanner />
        {connection !== 'online' ? (
          <Badge
            variant={connection === 'offline' ? 'destructive' : 'warning'}
            role="status"
            aria-live="polite"
          >
            <WifiSlash className="size-3" aria-hidden="true" />
            {connection === 'offline' ? 'Offline' : 'Reconnecting…'}
          </Badge>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          onClick={toggleCommandPalette}
          className="text-muted-foreground gap-2"
          aria-keyshortcuts="Control+K Meta+K"
        >
          <MagnifyingGlass aria-hidden="true" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="border-border bg-background text-3xs ml-1 hidden rounded-sm border px-1 font-mono sm:inline">
            {modifierKeyLabel()} K
          </kbd>
        </Button>
      </div>
    </header>
  )
}
