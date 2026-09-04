import { Check, CaretDown } from '@phosphor-icons/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'
import { OrgMark } from '@/components/common/OrgMark'

/**
 * Organization identity and switcher.
 *
 * With a single organization — the expected case — this is a static header
 * rather than a dropdown, so the common path has no affordance that does
 * nothing.
 */
export function OrganizationSwitcher({ collapsed }: { collapsed: boolean }) {
  const { organization, organizations, selectOrganization, status } = useWorkspace()

  if (status === 'loading') {
    return (
      <div className={cn('flex items-center gap-2 p-1.5', collapsed && 'justify-center')}>
        <Skeleton className="size-7 rounded-md" />
        {!collapsed ? <Skeleton className="h-3 w-24" /> : null}
      </div>
    )
  }

  if (!organization) return null

  const identity = (
    <>
      <OrgMark name={organization.name} logoUrl={organization.logoUrl} />
      {!collapsed ? (
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm leading-tight font-semibold">
            {organization.name}
          </span>
          <span className="text-2xs text-muted-foreground block truncate">
            {organization.tagline ?? `@${organization.slug}`}
          </span>
        </span>
      ) : null}
    </>
  )

  if (organizations.length <= 1) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md p-1.5',
          collapsed && 'justify-center p-1',
        )}
      >
        {identity}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'hover:bg-accent flex w-full items-center gap-2 rounded-md p-1.5 text-left transition-colors',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          collapsed && 'justify-center p-1',
        )}
        aria-label="Switch organization"
      >
        {identity}
        {!collapsed ? (
          <CaretDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => selectOrganization(org.id)}>
            <OrgMark name={org.name} logoUrl={org.logoUrl} className="size-5" />
            <span className="truncate">{org.name}</span>
            {org.id === organization.id ? (
              <Check className="ml-auto size-3.5" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
