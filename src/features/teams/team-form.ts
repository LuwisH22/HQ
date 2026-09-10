import { z } from 'zod'
import type { Team, TeamPatch } from '@/services/team.service'

/**
 * What a person types when they name a team.
 *
 * Both rules below also hold in Postgres: the lengths are the CHECK
 * constraints from 20250924005100, and `create_team` trims and refuses an
 * empty name in exactly the same words. Bypassing this form gains nothing; it
 * exists so the refusal arrives in a sentence rather than as a round trip.
 *
 * There is no stage, no status and no archived flag here. A team is either put
 * away or it is not, and that is its own action with its own permission —
 * `update_team` has nowhere to put one, and neither does this.
 */
export const teamFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'A name is required')
    .max(80, 'Keep the name under 80 characters'),
  description: z.string().trim().max(2000, 'Keep the description under 2000 characters'),
})

export type TeamFormValues = z.infer<typeof teamFormSchema>

/** The form a new team opens with: unnamed, undescribed. */
export function defaultsForNew(): TeamFormValues {
  return { name: '', description: '' }
}

/** A team, back in the fields it was written in. */
export function defaultsFromTeam(team: Team): TeamFormValues {
  return { name: team.name, description: team.description ?? '' }
}

/**
 * The form, as the service takes a change.
 *
 * Both fields are always sent, because the form holds both: a description
 * cleared in the form arrives as an empty string, which the routine turns into
 * "take this off" rather than into "leave it alone".
 */
export function toTeamPatch(values: TeamFormValues): TeamPatch {
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
  }
}
