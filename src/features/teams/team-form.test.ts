import { describe, expect, it } from 'vitest'
import {
  defaultsForNew,
  defaultsFromTeam,
  teamFormSchema,
  toTeamPatch,
  type TeamFormValues,
} from './team-form'
import type { Team } from '@/services/team.service'

/**
 * What a person types, checked before it becomes a team.
 *
 * Every rule here is also a CHECK constraint or a routine's refusal in
 * Postgres, so these tests are about the message arriving early rather than
 * about the database being protected — it protects itself.
 */

function values(overrides: Partial<TeamFormValues> = {}): TeamFormValues {
  return { ...defaultsForNew(), name: 'Valorant Main', ...overrides }
}

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    organizationId: 'org-1',
    name: 'Valorant Main',
    description: 'The starting five.',
    archivedAt: null,
    createdBy: 'user-1',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    memberCount: 5,
    ...overrides,
  }
}

describe('naming a team', () => {
  it('accepts an ordinary one', () => {
    expect(teamFormSchema.safeParse(values()).success).toBe(true)
  })

  it('needs a name that is not only spaces', () => {
    expect(teamFormSchema.safeParse(values({ name: '   ' })).success).toBe(false)
  })

  it('stops at eighty characters, which is where the column stops', () => {
    expect(teamFormSchema.safeParse(values({ name: 'x'.repeat(80) })).success).toBe(true)
    expect(teamFormSchema.safeParse(values({ name: 'x'.repeat(81) })).success).toBe(false)
  })

  it('trims before it measures', () => {
    const parsed = teamFormSchema.safeParse(values({ name: '  Valorant Main  ' }))
    expect(parsed.success && parsed.data.name).toBe('Valorant Main')
  })
})

describe('describing one', () => {
  it('is optional', () => {
    expect(teamFormSchema.safeParse(values({ description: '' })).success).toBe(true)
  })

  it('stops at two thousand characters, which is where the column stops', () => {
    expect(teamFormSchema.safeParse(values({ description: 'x'.repeat(2000) })).success).toBe(true)
    expect(teamFormSchema.safeParse(values({ description: 'x'.repeat(2001) })).success).toBe(false)
  })
})

describe('what the form has no way to say', () => {
  it('carries no archived state, no organization and no ids', () => {
    const patch = toTeamPatch(values())
    expect(Object.keys(patch).sort()).toEqual(['description', 'name'])
  })

  it('clears a description by emptying it, rather than leaving it alone', () => {
    // Null is what `update_team` reads as "take this off"; undefined would be
    // "leave it", and an empty field means the person cleared it on purpose.
    expect(toTeamPatch(values({ description: '   ' })).description).toBeNull()
  })
})

describe('reading a team back into the form', () => {
  it('round-trips a team through the form and back', () => {
    const original = team()
    const patch = toTeamPatch(defaultsFromTeam(original))
    expect(patch.name).toBe(original.name)
    expect(patch.description).toBe(original.description)
  })

  it('reads a team with no description as an empty field', () => {
    expect(defaultsFromTeam(team({ description: null })).description).toBe('')
  })

  it('opens an archived team on its own name, because archiving is not a field', () => {
    const archived = team({ archivedAt: '2026-03-01T00:00:00.000Z' })
    expect(defaultsFromTeam(archived).name).toBe('Valorant Main')
  })
})
