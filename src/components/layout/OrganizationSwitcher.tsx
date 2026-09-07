import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, CaretDown, Gear, SignOut } from '@phosphor-icons/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { organizationService } from '@/services/organization.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { presenceFrom } from '@/utils/presence'
import { useAuth } from '@/hooks/use-auth'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'
import { OrgMark } from '@/components/common/OrgMark'

/**
 * The organization, at the top of the sidebar.
 *
 * It reads as an HQ rather than as a settings label: the mark, the name, the
 * handle in mono, and how many people are about right now. The tagline moved
 * to the dashboard, because a slogan is not navigation.
 *
 * The caret is the org menu — switching organizations where there is more
 * than one, and the two account actions that used to live as bare icons in
 * the footer. Nothing new happens here; the same routes and the same sign-out.
 */
export function OrganizationSwitcher({ collapsed }: { collapsed: boolean }) {
  const { organization, organizations, selectOrganization, status } = useWorkspace()
  const { signOut } = useAuth()
  const navigate = useNavigate()

  // The roster the dashboard and the member list already hold. Presence is
  // read from it the same way they read it — no second source, and no
  // invented number.
  const membersQuery = useQuery({
    queryKey: queryKeys.members.all(organization?.id ?? 'none'),
    queryFn: () => organizationService.listMembers(organization?.id as string),
    enabled: Boolean(organization),
    staleTime: 60_000,
  })

  const online = useMemo(() => {
    const now = Date.now()
    return (membersQuery.data ?? []).filter(
      (member) => presenceFrom(member.profile.lastSeenAt, now) !== 'offline',
    ).length
  }, [membersQuery.data])

  async function handleSignOut(): Promise<void> {
    try {
      await signOut()
      void navigate('/auth/sign-in', { replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (status === 'loading') {
    return (
      <div
        className={cn('flex h-14 items-center gap-2.5 px-2', collapsed && 'justify-center px-0')}
      >
        <Skeleton className="size-8 rounded-md" />
        {!collapsed ? <Skeleton className="h-3 w-24" /> : null}
      </div>
    )
  }

  if (!organization) return null

  const identity = (
    <>
      <OrgMark
        name={organization.name}
        logoUrl={organization.logoUrl}
        className="size-8 rounded-md"
      />
      {!collapsed ? (
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm leading-tight font-semibold">
            {organization.name}
          </span>
          <span className="text-2xs text-muted-foreground block truncate font-mono">
            @{organization.slug}
            {membersQuery.data ? ` · ${String(online)} online` : ''}
          </span>
        </span>
      ) : null}
    </>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'hover:bg-accent flex h-14 w-full items-center gap-2.5 px-2 text-left transition-colors duration-[120ms]',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
          collapsed && 'justify-center px-0',
        )}
        aria-label="Organization menu"
      >
        {identity}
        {!collapsed ? (
          <CaretDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        {organizations.length > 1 ? (
          <>
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
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Gear aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={() => void handleSignOut()}>
          <SignOut aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
