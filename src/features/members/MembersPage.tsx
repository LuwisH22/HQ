import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/common/PageHeader'
import { Can } from '@/components/common/Can'
import { EmptyState, ErrorState, ForbiddenState, ListSkeleton } from '@/components/common/states'
import { organizationService } from '@/services/organization.service'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { displayNameFor } from '@/services/profile.service'
import { MemberRow } from './MemberRow'
import { InviteMemberDialog } from './InviteMemberDialog'
import { PendingInvitations } from './PendingInvitations'

/**
 * Member directory and role administration.
 *
 * Filtering happens in memory: a six-person organization fits comfortably in
 * one request, so a round trip per keystroke would be pure latency. The search
 * input is still debounced so the list does not re-sort mid-keystroke.
 */
export function MembersPage() {
  const { organization } = useWorkspace()
  const canView = usePermission('members.view')
  const canInvite = usePermission('members.invite')

  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 200)

  const inviteOpen = searchParams.get('invite') === '1'
  const setInviteOpen = (open: boolean) => {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        if (open) next.set('invite', '1')
        else next.delete('invite')
        return next
      },
      { replace: true },
    )
  }

  const organizationId = organization?.id

  const membersQuery = useQuery({
    queryKey: queryKeys.members.all(organizationId ?? 'none'),
    queryFn: () => organizationService.listMembers(organizationId as string),
    enabled: Boolean(organizationId) && canView,
  })

  const rolesQuery = useQuery({
    queryKey: queryKeys.roles.all(organizationId ?? 'none'),
    queryFn: () => organizationService.listRoles(organizationId as string),
    enabled: Boolean(organizationId) && canView,
    staleTime: 10 * 60_000,
  })

  const filtered = useMemo(() => {
    const members = membersQuery.data ?? []
    const needle = debouncedSearch.trim().toLowerCase()
    const matched = needle
      ? members.filter((member) => {
          const haystack = [
            displayNameFor(member.profile),
            member.profile.fullName,
            member.profile.email,
            member.profile.title,
            member.role.name,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          return haystack.includes(needle)
        })
      : members

    // Authority first, then alphabetical, so the roster reads like an org chart.
    return [...matched].sort((a, b) => {
      if (a.role.rank !== b.role.rank) return a.role.rank - b.role.rank
      return displayNameFor(a.profile).localeCompare(displayNameFor(b.profile))
    })
  }, [membersQuery.data, debouncedSearch])

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
        <ForbiddenState description="Your role does not include access to the member directory." />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Members"
        description={`Everyone in ${organization?.name ?? 'the organization'}, and what they can do.`}
        actions={
          <Can perm="members.invite">
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus aria-hidden="true" />
              Invite
            </Button>
          </Can>
        }
      />

      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, email or role"
          aria-label="Search members"
          className="pl-8"
        />
      </div>

      {membersQuery.isPending ? (
        <ListSkeleton rows={5} />
      ) : membersQuery.isError ? (
        <ErrorState error={membersQuery.error} onRetry={() => void membersQuery.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={debouncedSearch ? 'No members match that search' : 'No members yet'}
          description={
            debouncedSearch
              ? 'Try a different name, email or role.'
              : 'Invite your staff and players to get started.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map((member) => (
            <li key={member.id}>
              <MemberRow member={member} roles={rolesQuery.data ?? []} />
            </li>
          ))}
        </ul>
      )}

      {canInvite && organizationId ? (
        <>
          <PendingInvitations organizationId={organizationId} />
          <InviteMemberDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            organizationId={organizationId}
            roles={rolesQuery.data ?? []}
          />
        </>
      ) : null}
    </div>
  )
}
