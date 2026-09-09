import { describe, expect, it } from 'vitest'
import {
  defaultsForNew,
  defaultsFromProject,
  projectFormSchema,
  toProjectInput,
  toProjectPatch,
  type ProjectFormValues,
} from './project-form'
import { PROJECT_STATUSES, SELECTABLE_STATUSES } from './project-status'
import type { Project } from '@/services/project.service'

/**
 * What a person types, checked before it becomes a project.
 *
 * Every rule here is also a CHECK constraint or a routine's refusal in
 * Postgres, so these tests are about the message arriving early rather than
 * about the database being protected — it protects itself.
 */

const ORG = 'org-1'

function values(overrides: Partial<ProjectFormValues> = {}): ProjectFormValues {
  return { ...defaultsForNew(), name: 'Spring bootcamp', ...overrides }
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    organizationId: ORG,
    name: 'Spring bootcamp',
    description: 'Two weeks in Jakarta.',
    status: 'in_progress',
    startDate: '2026-10-01',
    dueDate: '2026-11-30',
    archivedAt: null,
    reviewStartedAt: null,
    reviewDeadlineAt: null,
    reviewDurationMinutes: null,
    reviewRound: 0,
    createdBy: 'user-1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    memberCount: 3,
    ...overrides,
  }
}

describe('naming a project', () => {
  it('accepts an ordinary one', () => {
    expect(projectFormSchema.safeParse(values()).success).toBe(true)
  })

  it('will not take one with no name', () => {
    const parsed = projectFormSchema.safeParse(values({ name: '   ' }))
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('A name is required')
    }
  })

  it('will not take a name longer than the column', () => {
    expect(projectFormSchema.safeParse(values({ name: 'x'.repeat(121) })).success).toBe(false)
    expect(projectFormSchema.safeParse(values({ name: 'x'.repeat(120) })).success).toBe(true)
  })

  it('trims what it stores', () => {
    expect(toProjectInput(values({ name: '  Spring bootcamp  ' }), ORG).name).toBe(
      'Spring bootcamp',
    )
  })

  it('will not take a description longer than the column', () => {
    expect(projectFormSchema.safeParse(values({ description: 'x'.repeat(2001) })).success).toBe(
      false,
    )
    expect(projectFormSchema.safeParse(values({ description: 'x'.repeat(2000) })).success).toBe(
      true,
    )
  })
})

describe('the status of a project', () => {
  it('offers only the two stages a project may start at, and not archived', () => {
    // Archiving has its own permission and its own confirmation; a dropdown
    // that could do it would be an authorization decision hidden in a field.
    // Archived is not a stage at all any more, so it cannot be offered.
    expect(SELECTABLE_STATUSES as readonly string[]).not.toContain('archived')
  })

  it('offers only the two stages a project may start at', () => {
    // Not review, and not done: those are places the workflow arrives at, and
    // `create_project` refuses them for the same reason.
    expect(SELECTABLE_STATUSES).toEqual(['planned', 'in_progress'])
  })

  it('keeps the four stages in lifecycle order', () => {
    expect(PROJECT_STATUSES).toEqual(['planned', 'in_progress', 'in_review', 'done'])
  })

  it('starts a new project as planned', () => {
    expect(defaultsForNew().status).toBe('planned')
  })

  it('refuses a status this product does not have', () => {
    const forged = { ...values(), status: 'blocked' }
    expect(projectFormSchema.safeParse(forged).success).toBe(false)
  })

  it('opens a project past the start on a stage somebody may choose', () => {
    // The create form offers two stages; a project in review is past both, so
    // the field opens on the nearest one it can. It is not drawn when editing,
    // and saving the form cannot move a project along in any case.
    expect(defaultsFromProject(project({ status: 'in_review' })).status).toBe('planned')
    expect(defaultsFromProject(project({ status: 'done' })).status).toBe('planned')
  })
})

describe('the dates a project runs over', () => {
  it('accepts both, either, or neither', () => {
    expect(projectFormSchema.safeParse(values()).success).toBe(true)
    expect(projectFormSchema.safeParse(values({ startDate: '2026-10-01' })).success).toBe(true)
    expect(projectFormSchema.safeParse(values({ dueDate: '2026-11-30' })).success).toBe(true)
    expect(
      projectFormSchema.safeParse(values({ startDate: '2026-10-01', dueDate: '2026-11-30' }))
        .success,
    ).toBe(true)
  })

  it('will not let a project be due before it starts', () => {
    const parsed = projectFormSchema.safeParse(
      values({ startDate: '2026-11-30', dueDate: '2026-10-01' }),
    )
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('A project cannot be due before it starts')
      expect(parsed.error.issues[0]?.path).toEqual(['dueDate'])
    }
  })

  it('allows a project that starts and is due on one day', () => {
    expect(
      projectFormSchema.safeParse(values({ startDate: '2026-10-01', dueDate: '2026-10-01' }))
        .success,
    ).toBe(true)
  })

  it('refuses something that is not a date', () => {
    expect(projectFormSchema.safeParse(values({ startDate: 'soon' })).success).toBe(false)
    expect(projectFormSchema.safeParse(values({ dueDate: '30-11-2026' })).success).toBe(false)
  })
})

describe('what the service is given', () => {
  it('turns an empty field into nothing rather than into an empty string', () => {
    const input = toProjectInput(values({ description: '', startDate: '', dueDate: '' }), ORG)
    expect(input.description).toBeNull()
    expect(input.startDate).toBeNull()
    expect(input.dueDate).toBeNull()
    expect(input.organizationId).toBe(ORG)
  })

  it('carries the dates through untouched, because a day is already a day', () => {
    const input = toProjectInput(values({ startDate: '2026-10-01', dueDate: '2026-11-30' }), ORG)
    expect(input.startDate).toBe('2026-10-01')
    expect(input.dueDate).toBe('2026-11-30')
  })

  it('sends every field on a change, so a cleared date is cleared', () => {
    const patch = toProjectPatch(values({ startDate: '', dueDate: '' }))
    expect(patch.startDate).toBeNull()
    expect(patch.dueDate).toBeNull()
    // And no organization: a project cannot change hands, and the routine has
    // nowhere to put one.
    expect('organizationId' in patch).toBe(false)
  })

  it('round-trips a project through the form and back', () => {
    const original = project()
    const patch = toProjectPatch(defaultsFromProject(original))
    expect(patch.name).toBe(original.name)
    expect(patch.description).toBe(original.description)
    expect(patch.startDate).toBe(original.startDate)
    expect(patch.dueDate).toBe(original.dueDate)
  })

  it('never sends a stage with an edit', () => {
    // The whole of 6.5 in one assertion: `update_project` has no status
    // argument, so a patch that carried one would be sending a field at a
    // routine that cannot accept it — and if it ever could, the lifecycle
    // would be optional again.
    expect('status' in toProjectPatch(defaultsFromProject(project()))).toBe(false)
  })

  it('reads a project with nothing optional set as empty fields', () => {
    const bare = defaultsFromProject(
      project({ description: null, startDate: null, dueDate: null, status: 'planned' }),
    )
    expect(bare.description).toBe('')
    expect(bare.startDate).toBe('')
    expect(bare.dueDate).toBe('')
  })
})
