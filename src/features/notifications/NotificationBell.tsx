import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, At, CalendarBlank } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { notificationService } from '@/services/notification.service'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'

/**
 * The bell, and what is behind it.
 *
 * Every row here is addressed to the signed-in member: the table's policy is
 * `recipient_id = auth.uid()` and there is no INSERT policy at all, so a
 * notification about a private channel only exists for somebody who could
 * have read the message that caused it.
 */
export function NotificationBell() {
  const { organization } = useWorkspace()
  const organizationId = organization?.id
  const queryClient = useQueryClient()

  const countQuery = useQuery({
    queryKey: queryKeys.notifications.unreadCount(organizationId ?? 'none'),
    queryFn: () => notificationService.unreadCount(organizationId as string),
    enabled: Boolean(organizationId),
  })

  const listQuery = useQuery({
    queryKey: queryKeys.notifications.all(organizationId ?? 'none'),
    queryFn: () => notificationService.list(organizationId as string),
    enabled: Boolean(organizationId),
  })

  const markRead = useMutation({
    mutationFn: () => notificationService.markRead(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all(organizationId ?? 'none'),
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.unreadCount(organizationId ?? 'none'),
      })
    },
  })

  if (!organizationId) return null

  const unread = countQuery.data ?? 0
  const notifications = listQuery.data ?? []

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground relative"
          aria-label={unread > 0 ? `Notifications, ${String(unread)} unread` : 'Notifications'}
        >
          <Bell className="size-4" aria-hidden="true" />
          {unread > 0 ? (
            <span
              className="bg-primary absolute top-0.5 right-0.5 size-1.5 rounded-full"
              aria-hidden="true"
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-border flex items-center gap-2 border-b px-3 py-2">
          <h2 className="display-eyebrow text-3xs text-muted-foreground flex-1">Notifications</h2>
          {unread > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-2xs h-6"
              loading={markRead.isPending}
              onClick={() => markRead.mutate()}
            >
              Mark all read
            </Button>
          ) : null}
        </div>

        {notifications.length === 0 ? (
          <p className="text-muted-foreground/70 text-2xs px-3 py-4 text-center leading-relaxed">
            Nothing yet. Mentions and calendar reminders land here.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1" aria-label="Notifications">
            {notifications.map((notification) => {
              const channelKey = notification.metadata['channel_key']
              const excerpt = notification.metadata['excerpt']
              // A calendar notification is about an event rather than a
              // message, so it points at the calendar and wears its icon.
              // Everything else about the row is unchanged.
              const calendar = notification.entityType === 'calendar_event'
              const Icon = calendar ? CalendarBlank : At

              return (
                <li key={notification.id}>
                  <Link
                    to={
                      calendar
                        ? '/calendar'
                        : typeof channelKey === 'string'
                          ? `/channels/${channelKey}`
                          : '/channels'
                    }
                    className={cn(
                      'hover:bg-accent flex items-start gap-2.5 px-3 py-2 transition-colors',
                      'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    )}
                  >
                    <Icon
                      className={cn(
                        'mt-px size-3.5 shrink-0',
                        notification.readAt === null
                          ? 'text-accent-text'
                          : 'text-muted-foreground/50',
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p
                        className={cn(
                          'text-xs leading-snug',
                          notification.readAt === null ? 'font-medium' : 'text-muted-foreground',
                        )}
                      >
                        {notification.summary}
                      </p>
                      {typeof excerpt === 'string' ? (
                        <p className="text-2xs text-muted-foreground/70 mt-0.5 truncate">
                          {excerpt}
                        </p>
                      ) : null}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
