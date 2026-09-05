import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/hooks/use-workspace'
import { useUiStore } from '@/stores/ui.store'
import { cn } from '@/lib/utils'
import { ChannelNav } from '@/features/channels/ChannelNav'
import { MOBILE_NAV_IDS, NAV_ITEMS, type NavItem } from './navigation'
import { OrganizationSwitcher } from './OrganizationSwitcher'
import { ProfileButton, SignOutButton } from './UserMenu'

/**
 * Bottom bar for phones.
 *
 * Mobile gets its own navigation model rather than a shrunken sidebar: the
 * five most-used destinations sit within thumb reach, and everything else is
 * behind the drawer. Targets are 44px+ per the touch guidance.
 */
export function MobileTabBar() {
  const { permissions } = useWorkspace()

  const items = useMemo(
    () =>
      MOBILE_NAV_IDS.map((id) => NAV_ITEMS.find((item) => item.id === id)).filter(
        (item): item is (typeof NAV_ITEMS)[number] =>
          item !== undefined && (item.requires.length === 0 || permissions.canAny(item.requires)),
      ),
    [permissions],
  )

  return (
    <nav
      aria-label="Primary"
      className="border-border bg-surface pb-safe flex shrink-0 items-stretch border-t md:hidden"
    >
      {items.map((item) => (
        <NavLink
          key={item.id}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) =>
            cn(
              'text-2xs flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className={cn('size-5', isActive && 'stroke-[2.25]')} aria-hidden="true" />
              <span className="truncate leading-none">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function DrawerRow({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors',
          isActive ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground',
        )
      }
    >
      <item.icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
      {!item.shipped ? (
        <span className="text-2xs text-muted-foreground/60 ml-auto tracking-wider uppercase">
          Soon
        </span>
      ) : null}
    </NavLink>
  )
}

/** Slide-in drawer holding the full navigation on small screens. */
export function MobileNavDrawer() {
  const open = useUiStore((state) => state.mobileNavOpen)
  const setOpen = useUiStore((state) => state.setMobileNavOpen)
  const { permissions } = useWorkspace()

  const items = NAV_ITEMS.filter(
    (item) => item.requires.length === 0 || permissions.canAny(item.requires),
  )
  // Same shape as the desktop sidebar: the channel list stands in for the two
  // `chat` rows, so the drawer is a way into a conversation and not just a
  // list of screens.
  const primaryItems = items.filter((item) => item.group === 'primary')
  const organizationItems = items.filter((item) => item.group === 'organization')

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 fixed inset-0 z-50 bg-black/70 md:hidden" />
        <DialogPrimitive.Content
          className={cn(
            'border-border bg-surface fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
            'md:hidden',
          )}
        >
          <VisuallyHidden>
            <DialogPrimitive.Title>Navigation</DialogPrimitive.Title>
          </VisuallyHidden>

          <div className="border-border pt-safe flex items-center gap-2 border-b p-2">
            <div className="flex-1">
              <OrganizationSwitcher collapsed={false} />
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close navigation">
                <X aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <nav aria-label="All sections" className="min-h-0 flex-1 overflow-y-auto p-3">
            <ul className="space-y-0.5">
              {primaryItems.map((item) => (
                <li key={item.id}>
                  <DrawerRow item={item} onNavigate={() => setOpen(false)} />
                </li>
              ))}
            </ul>

            <ChannelNav onNavigate={() => setOpen(false)} />

            <p className="text-3xs text-foreground/42 px-1 pt-4 pb-1 font-semibold tracking-[0.1em] uppercase">
              Organization
            </p>
            <ul className="space-y-0.5">
              {organizationItems.map((item) => (
                <li key={item.id}>
                  <DrawerRow item={item} onNavigate={() => setOpen(false)} />
                </li>
              ))}
            </ul>
          </nav>

          <div className="border-border pb-safe flex items-center gap-1 border-t p-2">
            <ProfileButton collapsed={false} />
            <SignOutButton />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
