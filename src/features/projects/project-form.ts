import { z } from 'zod'
import type { Project, ProjectInput, ProjectPatch } from '@/services/project.service'
import { SELECTABLE_STATUSES } from './project-status'

/**
 * What a person types, and what the database is given.
 *
 * Every rule below also holds in Postgres. The lengths are the CHECK
 * constraints from 20250918004500, the statuses are its enumeration, and
 * `due_date >= start_date` is a constraint as well as a refinement. Bypassing
 * this form gains nothing; it exists so the refusal arrives in a sentence
 * rather than as a round trip.
 *
 * Dates are days, held as the string an `<input type="date">` deals in. A
 * project runs over dates somebody writes on a whiteboard — it does not start
 * at 14:32 in a particular zone — so there is no instant here to convert and
 * no timezone logic to duplicate.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Empty means "no date", which is different from a malformed one. */
const optionalDay = z
  .string()
  .refine((value) => value === '' || DAY_PATTERN.test(value), 'Pick a date or leave it empty')

export const projectFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'A name is required')
      .max(120, 'Keep the name under 120 characters'),
    description: z.string().trim().max(2000, 'Keep the description under 2000 characters'),
    status: z.enum(SELECTABLE_STATUSES),
    startDate: optionalDay,
    dueDate: optionalDay,
  })
  .superRefine((values, ctx) => {
    // A refinement runs even when a field above it failed, so nothing here may
    // assume a readable date: the field's own message is the one worth
    // showing, and comparing rubbish would only add noise.
    if (!DAY_PATTERN.test(values.startDate) || !DAY_PATTERN.test(values.dueDate)) return

    // Both are ISO days, so string order is date order.
    if (values.dueDate < values.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dueDate'],
        message: 'A project cannot be due before it starts',
      })
    }
  })

export type ProjectFormValues = z.infer<typeof projectFormSchema>

/** The form a new project opens with: planned, unnamed, undated. */
export function defaultsForNew(): ProjectFormValues {
  return { name: '', description: '', status: 'planned', startDate: '', dueDate: '' }
}

/**
 * A project, back in the fields it was written in.
 *
 * An archived project keeps its own status in the database, but the form
 * offers only the three a person may choose; it opens on the nearest thing it
 * can, and saving does not un-archive anything by itself.
 */
export function defaultsFromProject(project: Project): ProjectFormValues {
  const status = (SELECTABLE_STATUSES as readonly string[]).includes(project.status)
    ? (project.status as ProjectFormValues['status'])
    : 'planned'

  return {
    name: project.name,
    description: project.description ?? '',
    status,
    startDate: project.startDate ?? '',
    dueDate: project.dueDate ?? '',
  }
}

/** The form, as the service takes it for a new project. */
export function toProjectInput(values: ProjectFormValues, organizationId: string): ProjectInput {
  return {
    organizationId,
    name: values.name.trim(),
    description: values.description.trim() || null,
    status: values.status,
    startDate: values.startDate || null,
    dueDate: values.dueDate || null,
  }
}

/**
 * And as it takes a change.
 *
 * Every field is sent, because the form holds all of them: a date cleared in
 * the form arrives as null, which the service turns into the routine's "take
 * this off" rather than into "leave it alone".
 */
export function toProjectPatch(values: ProjectFormValues): ProjectPatch {
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    status: values.status,
    startDate: values.startDate || null,
    dueDate: values.dueDate || null,
  }
}
