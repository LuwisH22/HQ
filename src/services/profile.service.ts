import { getSupabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { demoProfileService } from '@/services/demo'
import type { Profile, ProfilePatch, ProfileService } from './service-contracts'
import type { ProfileRow } from '@/types/database.types'

export type { Profile, ProfilePatch } from './service-contracts'

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    title: row.title,
    bio: row.bio,
    timezone: row.timezone,
    lastSeenAt: row.last_seen_at,
  }
}

const PROFILE_COLUMNS =
  'id, email, full_name, display_name, avatar_url, title, bio, timezone, last_seen_at, created_at, updated_at'

export const supabaseProfileService: ProfileService = {
  /** The signed-in user's profile. RLS restricts this to their own row. */
  async getMine(): Promise<Profile | null> {
    const supabase = getSupabase()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError) throw toAppError(userError)

    const userId = userData.user?.id
    if (!userId) return null

    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle()

    if (error) throw toAppError(error)
    return data ? toProfile(data) : null
  },

  async update(patch: ProfilePatch): Promise<Profile> {
    const supabase = getSupabase()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError) throw toAppError(userError)

    const userId = userData.user?.id
    if (!userId) throw toAppError({ status: 401, message: 'Not signed in' })

    const { data, error } = await supabase
      .from('profiles')
      .update({
        full_name: patch.fullName,
        display_name: patch.displayName,
        title: patch.title,
        bio: patch.bio,
        ...(patch.timezone ? { timezone: patch.timezone } : {}),
      })
      .eq('id', userId)
      .select(PROFILE_COLUMNS)
      .single()

    if (error) throw toAppError(error)
    return toProfile(data)
  },

  /**
   * Heartbeat for presence. Best-effort: a failure here must never interrupt
   * what the user is doing, so it swallows errors by design.
   */
  async touchLastSeen(): Promise<void> {
    try {
      const supabase = getSupabase()
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) return

      await supabase
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', userId)
    } catch {
      // Intentionally ignored — presence is advisory.
    }
  },
}

/** Best display label for a person, in decreasing order of specificity. */
export function displayNameFor(profile: {
  displayName?: string | null
  fullName?: string | null
  email?: string | null
}): string {
  return profile.displayName || profile.fullName || profile.email?.split('@')[0] || 'Unknown'
}

/** Up-to-two-letter avatar fallback. */
export function initialsFor(profile: {
  displayName?: string | null
  fullName?: string | null
  email?: string | null
}): string {
  const source = profile.fullName || profile.displayName || profile.email || '?'
  const parts = source
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase()
  return `${(parts[0] ?? '').charAt(0)}${(parts[1] ?? '').charAt(0)}`.toUpperCase()
}

/** Dispatches to the demo store when a demo session is active. */
function impl(): ProfileService {
  return isDemoSessionActive() ? demoProfileService : supabaseProfileService
}

export const profileService: ProfileService = {
  getMine: () => impl().getMine(),
  update: (patch) => impl().update(patch),
  touchLastSeen: () => impl().touchLastSeen(),
}
