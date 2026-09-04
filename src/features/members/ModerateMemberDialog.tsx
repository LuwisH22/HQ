import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Warning } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/common/FormField'
import { organizationService } from '@/services/organization.service'
import type { OrganizationMember } from '@/services/organization.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { SUSPENSION_DURATIONS } from '@/lib/moderation'
import { cn } from '@/lib/utils'
import { displayNameFor } from '@/services/profile.service'

export type ModerationIntent = 'suspend' | 'unsuspend' | 'ban' | 'unban'

const COPY: Record<
  ModerationIntent,
  { title: string; description: string; confirm: string; destructive: boolean }
> = {
  suspend: {
    title: 'Suspend member',
    description: 'They keep their roles but lose access until the suspension lapses or is lifted.',
    confirm: 'Suspend',
    destructive: false,
  },
  unsuspend: {
    title: 'Lift suspension',
    description: 'Access is restored immediately. Their roles are unchanged.',
    confirm: 'Lift suspension',
    destructive: false,
  },
  ban: {
    title: 'Ban member',
    description:
      'Organization access is revoked immediately and their sign-in is blocked. Only an explicit unban reverses this.',
    confirm: 'Ban member',
    destructive: true,
  },
  unban: {
    title: 'Lift ban',
    description: 'Access and sign-in are restored. Their roles are unchanged.',
    confirm: 'Lift ban',
    destructive: false,
  },
}

/**
 * Moderation actions, all four of them.
 *
 * Deliberately not optimistic: every one of these is re-checked in Postgres —
 * permission, hierarchy, ownership, self-moderation — and showing a member as
 * banned before the database has agreed would be a lie the interface cannot
 * back up. The dialog waits, then refetches.
 */
export function ModerateMemberDialog({
  open,
  onOpenChange,
  member,
  intent,
  organizationId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: OrganizationMember
  intent: ModerationIntent
  organizationId: string
}) {
  const queryClient = useQueryClient()
  const copy = COPY[intent]
  const name = displayNameFor(member.profile)

  const [reason, setReason] = useState('')
  const [days, setDays] = useState<number | null>(7)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!open) return
    setReason('')
    setDays(7)
    setTyped('')
  }, [open, intent])

  const reasonRequired = intent === 'suspend' || intent === 'ban'
  // A ban is the one action with no automatic way back, so it asks for more
  // than a click.
  const confirmationOk = intent !== 'ban' || typed.trim().toUpperCase() === 'BAN'
  const canSubmit = (!reasonRequired || reason.trim().length > 0) && confirmationOk

  const mutation = useMutation({
    mutationFn: async () => {
      if (intent === 'suspend') {
        await organizationService.suspendMember(member.id, reason.trim(), days)
        return null
      }
      if (intent === 'unsuspend') {
        await organizationService.unsuspendMember(member.id, reason.trim() || undefined)
        return null
      }
      if (intent === 'ban') {
        return organizationService.banMember(member.id, reason.trim())
      }
      return organizationService.unbanMember(member.id, reason.trim() || undefined)
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.members.all(organizationId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.audit.recent(organizationId, 12) })

      // The organization half always succeeded by this point. The auth half is
      // reported separately rather than folded into a single "done".
      if (result && !result.authUpdated && result.warning) {
        toast.warning(result.warning, { duration: 10_000 })
      } else {
        toast.success(`${copy.confirm} — ${name}.`)
      }
      onOpenChange(false)
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0">
        <div className="border-border border-b px-5 py-4">
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="mt-1">{copy.description}</DialogDescription>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-xs">
            <span className="text-muted-foreground">Member: </span>
            <span className="font-medium">{name}</span>
          </p>

          {intent === 'suspend' ? (
            <FormField label="Duration" required>
              {() => (
                <div className="flex flex-wrap gap-1.5">
                  {SUSPENSION_DURATIONS.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={days === option.days}
                      onClick={() => setDays(option.days)}
                      className={cn(
                        'rounded-sm border px-2.5 py-1 text-xs transition-colors duration-[140ms]',
                        days === option.days
                          ? 'border-primary bg-primary/14 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </FormField>
          ) : null}

          <FormField label="Reason" required={reasonRequired}>
            {(props) => (
              <Input
                {...props}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={reasonRequired ? 'Recorded in the moderation history' : 'Optional'}
                maxLength={500}
                autoFocus
              />
            )}
          </FormField>

          {intent === 'ban' ? (
            <>
              <div className="border-destructive/40 bg-destructive/8 flex items-start gap-2.5 rounded-md border p-3">
                <Warning className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p className="text-muted-foreground text-2xs leading-relaxed">
                  Organization data is blocked immediately. An access token already issued to them
                  stays valid until it expires — up to an hour — but it returns no organization data
                  during that time.
                </p>
              </div>

              <FormField label="Type BAN to confirm" required>
                {(props) => (
                  <Input
                    {...props}
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder="BAN"
                    autoComplete="off"
                  />
                )}
              </FormField>
            </>
          ) : null}
        </div>

        <div className="border-border bg-elevated flex justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={copy.destructive ? 'destructive' : 'default'}
            loading={mutation.isPending}
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
          >
            {copy.confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
