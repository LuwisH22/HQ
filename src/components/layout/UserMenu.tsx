import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LogOut, Settings, User as UserIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage, AvatarStatus } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { displayNameFor, initialsFor, profileService } from '@/services/profile.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/hooks/use-auth'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'

export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { signOut } = useAuth()
  const { membership } = useWorkspace()
  const navigate = useNavigate()

  const profileQuery = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: () => profileService.getMine(),
    staleTime: 5 * 60_000,
  })

  const profile = profileQuery.data

  if (profileQuery.isPending) {
    return (
      <div className={cn('flex items-center gap-2 p-1.5', collapsed && 'justify-center')}>
        <Skeleton className="size-8 rounded-md" />
        {!collapsed ? <Skeleton className="h-3 w-20" /> : null}
      </div>
    )
  }

  if (!profile) return null

  const name = displayNameFor(profile)

  async function handleSignOut() {
    try {
      await signOut()
      void navigate('/auth/sign-in', { replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'hover:bg-accent flex w-full items-center gap-2 rounded-md p-1.5 text-left transition-colors',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          collapsed && 'justify-center p-1',
        )}
        aria-label="Account menu"
      >
        <span className="relative shrink-0">
          <Avatar>
            {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt="" /> : null}
            <AvatarFallback>{initialsFor(profile)}</AvatarFallback>
          </Avatar>
          <AvatarStatus status="online" />
        </span>
        {!collapsed ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm leading-tight font-medium">{name}</span>
            <span className="text-2xs text-muted-foreground block truncate">
              {membership?.role.name ?? profile.title ?? 'Member'}
            </span>
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="tracking-normal normal-case">
          <span className="text-foreground block truncate text-sm font-medium">{name}</span>
          <span className="text-2xs text-muted-foreground block truncate font-normal">
            {profile.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate('/settings/profile')}>
          <UserIcon aria-hidden="true" />
          Your profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigate('/settings')}>
          <Settings aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void handleSignOut()}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
