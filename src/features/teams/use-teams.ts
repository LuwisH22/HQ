import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  teamService,
  type Team,
  type TeamMember,
  type TeamPatch,
  type TeamRosterPatch,
} from '@/services/team.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'

/**
 * The organization's teams, and the writes that change them.
 *
 * Server state in TanStack Query, as everything server-shaped here is. Nothing
 * about a team is worth keeping in a store: the list is a query, and which
 * dialog is open is local state where it belongs.
 *
 * Nothing is optimistic. Every one of these is a rule the database enforces
 * and may refuse — an archived team taking an edit, a suspended member joining
 * a roster — and a screen that showed the change first and took it back a
 * moment later would be telling a story the server never agreed to.
 */
export function useTeams(organizationId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.teams.list(organizationId ?? 'none'),
    queryFn: (): Promise<Team[]> => teamService.list(organizationId as string),
    enabled: Boolean(organizationId) && enabled,
    // Teams change on the order of weeks, not seconds.
    staleTime: 60_000,
  })
}

export function useTeam(organizationId: string | undefined, teamId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.teams.detail(organizationId ?? 'none', teamId ?? 'none'),
    queryFn: (): Promise<Team | null> => teamService.get(teamId as string),
    enabled: Boolean(organizationId) && Boolean(teamId),
    staleTime: 60_000,
  })
}

export function useTeamMembers(
  organizationId: string | undefined,
  teamId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.teams.members(organizationId ?? 'none', teamId ?? 'none'),
    queryFn: (): Promise<TeamMember[]> => teamService.listMembers(teamId as string),
    enabled: Boolean(organizationId) && Boolean(teamId) && enabled,
    staleTime: 30_000,
  })
}

/**
 * Every roster in the organization, for the faces on the list.
 *
 * One request for all of them rather than one per row. It waits for the list,
 * because the ids are what it asks about — until then there is nothing to ask.
 */
export function useTeamRosters(organizationId: string | undefined, teams: readonly Team[]) {
  const ids = teams.map((team) => team.id)

  return useQuery({
    queryKey: queryKeys.teams.rosters(organizationId ?? 'none'),
    queryFn: (): Promise<Record<string, TeamMember[]>> => teamService.listRosters(ids),
    enabled: Boolean(organizationId) && ids.length > 0,
    staleTime: 30_000,
  })
}

/**
 * Everything that changes a team or its roster.
 *
 * The two halves are kept apart deliberately, because the permissions behind
 * them are: `teams.manage` configures a team, `teams.roster_manage` decides
 * who is on it, and a coach holds the second without the first. Which family
 * each write invalidates follows the same split — putting somebody on a side
 * refreshes the roster and the counts the list draws, and nothing else.
 */
export function useTeamMutations(organizationId: string | undefined, teamId?: string) {
  const queryClient = useQueryClient()
  const org = organizationId ?? 'none'

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.teams.list(org) })
  const invalidateDetail = () =>
    teamId
      ? queryClient.invalidateQueries({ queryKey: queryKeys.teams.detail(org, teamId) })
      : Promise.resolve()
  const invalidateMembers = () =>
    teamId
      ? queryClient.invalidateQueries({ queryKey: queryKeys.teams.members(org, teamId) })
      : Promise.resolve()
  const invalidateRosters = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.teams.rosters(org) })

  const complain = (error: unknown) => {
    toast.error(errorMessage(error))
  }

  const create = useMutation({
    mutationFn: (input: { name: string; description: string | null }) =>
      teamService.create({ organizationId: org, ...input }),
    onSuccess: invalidateList,
    onError: complain,
  })

  const update = useMutation({
    mutationFn: (patch: TeamPatch) => teamService.update(teamId as string, patch),
    // The name and description are on both screens.
    onSuccess: async () => {
      await invalidateDetail()
      await invalidateList()
    },
    onError: complain,
  })

  const archive = useMutation({
    mutationFn: () => teamService.archive(teamId as string),
    onSuccess: async () => {
      await invalidateDetail()
      await invalidateList()
    },
    onError: complain,
  })

  const restore = useMutation({
    mutationFn: () => teamService.restore(teamId as string),
    onSuccess: async () => {
      await invalidateDetail()
      await invalidateList()
    },
    onError: complain,
  })

  // The list draws avatars and a head count, so a roster change makes it wrong
  // too — but only those three families, never the whole application.
  const rosterChanged = async () => {
    await invalidateMembers()
    await invalidateRosters()
    await invalidateDetail()
    await invalidateList()
  }

  const addMember = useMutation({
    mutationFn: (memberId: string) => teamService.addMember(teamId as string, memberId),
    onSuccess: rosterChanged,
    onError: complain,
  })

  const removeMember = useMutation({
    mutationFn: (memberId: string) => teamService.removeMember(teamId as string, memberId),
    onSuccess: rosterChanged,
    onError: complain,
  })

  const updateMember = useMutation({
    mutationFn: ({ memberId, patch }: { memberId: string; patch: TeamRosterPatch }) =>
      teamService.updateMember(teamId as string, memberId, patch),
    // A position or a status changes the roster and the counts drawn from it,
    // and nothing else in the application.
    onSuccess: rosterChanged,
    onError: complain,
  })

  /**
   * Off this team and onto another one.
   *
   * Two teams are wrong afterwards, so two team detail families and two roster
   * families are refreshed — and the batched rosters the list draws its faces
   * from, which held both. Still four keys and a list, rather than everything.
   */
  const moveMember = useMutation({
    mutationFn: ({ memberId, toTeamId }: { memberId: string; toTeamId: string }) =>
      teamService.moveMember(teamId as string, toTeamId, memberId),
    onSuccess: async (_result, variables) => {
      await rosterChanged()
      await queryClient.invalidateQueries({
        queryKey: queryKeys.teams.members(org, variables.toTeamId),
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.teams.detail(org, variables.toTeamId),
      })
    },
    onError: complain,
  })

  return { create, update, archive, restore, addMember, removeMember, updateMember, moveMember }
}
