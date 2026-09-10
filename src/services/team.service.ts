import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { firstOf } from './postgrest'
import type {
  Team,
  TeamInput,
  TeamMember,
  TeamPatch,
  TeamRosterPatch,
  TeamService,
} from './service-contracts'

export type { Team, TeamInput, TeamMember, TeamPatch, TeamRosterPatch } from './service-contracts'

/**
 * The organization's teams, and who is on them.
 *
 * Reads go straight at the tables under the caller's own JWT, so the
 * `teams.view` policy is what decides what comes back — a member of another
 * organization gets zero rows rather than an error, and there is no filtering
 * here that a mistake could widen. Writes go through the SECURITY DEFINER
 * routines, as every protected write in this application does.
 *
 * There is no `remove`. 7.1 archives, and nothing deletes a team: teams are
 * what rosters, scrims and results will hang off, and a cascade is not an undo.
 * There is no delete routine behind this to call even if something tried.
 */

const COLUMNS =
  'id, organization_id, name, description, archived_at, created_by, created_at, updated_at'

interface Row {
  id: string
  organization_id: string
  name: string
  description: string | null
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  team_members?: { count: number }[] | { count: number } | null
}

function toTeam(row: Row): Team {
  const counted = firstOf(row.team_members)
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    archivedAt: row.archived_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: counted?.count ?? 0,
  }
}

const ROSTER_COLUMNS = `member_id, added_at, roster_position, roster_status,
   member:organization_members!team_members_member_id_fkey (
     id, user_id,
     profile:profiles!organization_members_user_id_fkey (
       id, email, full_name, display_name, avatar_url, title, timezone, last_seen_at
     )
   )`

/**
 * One roster row, or nothing.
 *
 * A row whose person cannot be read is not half a person: it is nothing to
 * draw, so it is dropped rather than rendered as a blank.
 */
function toMember(entry: unknown): TeamMember | null {
  const row = entry as {
    member_id: string
    added_at: string
    roster_position: string | null
    roster_status: TeamMember['status']
    member: unknown
  }
  const member = firstOf(row.member) as { user_id: string; profile: unknown } | null
  const profile = firstOf(member?.profile) as {
    id: string
    email: string
    full_name: string | null
    display_name: string | null
    avatar_url: string | null
    title: string | null
    timezone: string
    last_seen_at: string | null
  } | null

  if (!member || !profile) return null

  return {
    memberId: row.member_id,
    userId: member.user_id,
    position: row.roster_position,
    status: row.roster_status,
    addedAt: row.added_at,
    profile: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      title: profile.title,
      timezone: profile.timezone,
      lastSeenAt: profile.last_seen_at,
    },
  }
}

export const supabaseTeamService: TeamService = {
  async list(organizationId: string): Promise<Team[]> {
    const { data, error } = await getSupabase()
      .from('teams')
      // The count comes from the database rather than from a second round
      // trip, and is scoped by the roster's own policy.
      .select(`${COLUMNS}, team_members(count)`)
      .eq('organization_id', organizationId)
      .order('name')

    if (error) throw toAppError(error)
    return ((data ?? []) as unknown as Row[]).map(toTeam)
  },

  async get(teamId: string): Promise<Team | null> {
    const { data, error } = await getSupabase()
      .from('teams')
      .select(`${COLUMNS}, team_members(count)`)
      .eq('id', teamId)
      .maybeSingle()

    if (error) throw toAppError(error)
    return data ? toTeam(data) : null
  },

  async create(input: TeamInput): Promise<string> {
    const { data, error } = await getSupabase().rpc('create_team', {
      p_organization_id: input.organizationId,
      p_name: input.name,
      p_description: input.description ?? null,
    })

    if (error) throw toAppError(error)
    return data
  },

  /** A partial update: anything left out is left alone. */
  async update(teamId: string, input: TeamPatch): Promise<void> {
    const { error } = await getSupabase().rpc('update_team', {
      p_team_id: teamId,
      p_name: input.name ?? null,
      p_description: input.description ?? null,
    })

    if (error) throw toAppError(error)
  },

  async archive(teamId: string): Promise<void> {
    const { error } = await getSupabase().rpc('archive_team', { p_team_id: teamId })
    if (error) throw toAppError(error)
  },

  async restore(teamId: string): Promise<void> {
    const { error } = await getSupabase().rpc('restore_team', { p_team_id: teamId })
    if (error) throw toAppError(error)
  },

  async listRosters(teamIds: readonly string[]): Promise<Record<string, TeamMember[]>> {
    if (teamIds.length === 0) return {}

    const { data, error } = await getSupabase()
      .from('team_members')
      .select(`team_id, ${ROSTER_COLUMNS}`)
      .in('team_id', [...teamIds])
      .order('added_at')

    if (error) throw toAppError(error)

    const out: Record<string, TeamMember[]> = {}
    for (const entry of (data ?? []) as unknown[]) {
      const row = entry as { team_id: string }
      const member = toMember(entry)
      if (!member) continue
      const bucket = out[row.team_id]
      if (bucket) bucket.push(member)
      else out[row.team_id] = [member]
    }
    return out
  },

  async listMembers(teamId: string): Promise<TeamMember[]> {
    const { data, error } = await getSupabase()
      .from('team_members')
      .select(ROSTER_COLUMNS)
      .eq('team_id', teamId)
      .order('added_at')

    if (error) throw toAppError(error)
    return ((data ?? []) as unknown[]).flatMap((entry) => {
      const member = toMember(entry)
      return member ? [member] : []
    })
  },

  async addMember(teamId: string, memberId: string): Promise<void> {
    const { error } = await getSupabase().rpc('add_team_member', {
      p_team_id: teamId,
      p_member_id: memberId,
    })
    if (error) throw toAppError(error)
  },

  async removeMember(teamId: string, memberId: string): Promise<void> {
    const { error } = await getSupabase().rpc('remove_team_member', {
      p_team_id: teamId,
      p_member_id: memberId,
    })
    if (error) throw toAppError(error)
  },

  /**
   * What somebody does on a team, and whether they are starting.
   *
   * A key that is not there leaves the column alone; a null position takes it
   * off, which the routine reads through its own flag rather than by guessing
   * what null meant.
   */
  async updateMember(
    teamId: string,
    memberId: string,
    patch: TeamRosterPatch,
  ): Promise<void> {
    const { error } = await getSupabase().rpc('update_team_member', {
      p_team_id: teamId,
      p_member_id: memberId,
      p_position: patch.position ?? null,
      p_clear_position: 'position' in patch && patch.position === null,
      p_status: patch.status ?? null,
    })

    if (error) throw toAppError(error)
  },

  async moveMember(fromTeamId: string, toTeamId: string, memberId: string): Promise<void> {
    const { error } = await getSupabase().rpc('move_team_member', {
      p_from_team_id: fromTeamId,
      p_to_team_id: toTeamId,
      p_member_id: memberId,
    })
    if (error) throw toAppError(error)
  },
}

/** Demo mode is an in-memory store with no organization to have teams in. */
const DEMO_MESSAGE = 'Teams are not part of demo mode.'
const refuse = () => Promise.reject(new AppError('validation', DEMO_MESSAGE))

const demoTeamService: TeamService = {
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(null),
  create: refuse,
  update: refuse,
  archive: refuse,
  restore: refuse,
  listMembers: () => Promise.resolve([]),
  listRosters: () => Promise.resolve({}),
  addMember: refuse,
  removeMember: refuse,
  updateMember: refuse,
  moveMember: refuse,
}

function impl(): TeamService {
  return isDemoSessionActive() ? demoTeamService : supabaseTeamService
}

export const teamService: TeamService = {
  list: (organizationId) => impl().list(organizationId),
  get: (teamId) => impl().get(teamId),
  create: (input) => impl().create(input),
  update: (teamId, input) => impl().update(teamId, input),
  archive: (teamId) => impl().archive(teamId),
  restore: (teamId) => impl().restore(teamId),
  listMembers: (teamId) => impl().listMembers(teamId),
  listRosters: (teamIds) => impl().listRosters(teamIds),
  addMember: (teamId, memberId) => impl().addMember(teamId, memberId),
  removeMember: (teamId, memberId) => impl().removeMember(teamId, memberId),
  updateMember: (teamId, memberId, patch) => impl().updateMember(teamId, memberId, patch),
  moveMember: (fromTeamId, toTeamId, memberId) =>
    impl().moveMember(fromTeamId, toTeamId, memberId),
}
