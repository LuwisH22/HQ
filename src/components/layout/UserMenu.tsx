import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { SignOut } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage, AvatarStatus } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { displayNameFor, initialsFor, profileService } from '@/services/profile.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/hooks/use-auth'
import { useWorkspace } from '@/hooks/use-workspace'
import { useUiStore } from '@/stores/ui.store'
import { cn } from '@/lib/utils'

/**
 * The sidebar footer: who you are, and the way out.
 *
 * Three controls that do three different things, kept visually distinct
 * because they used to be one dropdown and one small arrow — and the arrow
 * that collapses the sidebar is easily mistaken for a way to sign out.
 *
 * Your name opens your profile. The door signs you out. Collapsing the
 * sidebar is the caller's business and lives beside these, not among them.
 */

/** Your name and role. Opens the profile dialog; navigates nowhere. */
export function ProfileButton({ collapsed }: { collapsed: boolean }) {
  const { membership } = useWorkspace()
  const setProfileOpen = useUiStore((state) => state.setProfileOpen)

  const profileQuery = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: () => profileService.getMine(),
    staleTime: 5 * 60_000,
  })

  const profile = profileQuery.data

  if (profileQuery.isPending) {
    return (
      <div className={cn('flex flex-1 items-center gap-2 p-1.5', collapsed && 'justify-center')}>
        <Skeleton className="size-8 rounded-md" />
        {!collapsed ? <Skeleton className="h-3 w-20" /> : null}
      </div>
    )
  }

  if (!profile) return null

  const name = displayNameFor(profile)

  const button = (
    <button
      type="button"
      onClick={() => setProfileOpen(true)}
      className={cn(
        'hover:bg-foreground/7 flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-left transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        collapsed && 'flex-none justify-center p-1',
      )}
      aria-label="Your profile"
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
    </button>
  )

  if (!collapsed) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{name}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Sign out.
 *
 * Red and door-shaped, and its own control rather than an entry inside a menu:
 * leaving should not require finding out where it is hidden. The flow behind
 * it is unchanged — `signOut()` still revokes every session the user holds.
 */
export function SignOutButton() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut(): Promise<void> {
    try {
      await signOut()
      void navigate('/auth/sign-in', { replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void handleSignOut()}
          aria-label="Log out"
          className="text-destructive hover:bg-destructive/12 hover:text-destructive size-9 shrink-0"
        >
          <SignOut className="size-[21px]" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Log out</TooltipContent>
    </Tooltip>
  )
}
