import type { CalendarEvent } from '@/services/calendar.service'
import { useAuth } from '@/hooks/use-auth'
import { usePermission } from '@/hooks/use-permission'

/**
 * Whether this reader may change this event.
 *
 * The same rule `can_edit_calendar_event` applies in Postgres, restated here
 * so the interface offers what the database would accept: `calendar.manage`
 * changes anything, and the person who created it changes their own while they
 * still hold `calendar.create`. Nothing reads a role's name, and this decides
 * only what is drawn — the routine decides what happens.
 */
export function useCanEditEvent(event: CalendarEvent | null): boolean {
  const { user } = useAuth()
  const canManage = usePermission('calendar.manage')
  const canCreate = usePermission('calendar.create')

  if (!event) return false
  if (canManage) return true
  return canCreate && event.createdBy !== null && event.createdBy === user?.id
}
