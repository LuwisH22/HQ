import { z } from 'zod'
import type { LabelInput } from '@/services/label.service'
import { LABEL_COLORS } from './label-colors'

/**
 * What a label may be called, and what it may look like.
 *
 * Both rules also hold in Postgres: the lengths are the CHECK constraints from
 * 20250920004700 and the six colours are its enumeration. Uniqueness is not
 * here, because only the database can answer it — two people naming a label at
 * the same moment is a question no form can settle.
 */
export const labelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'A label needs a name')
    .max(40, 'Keep the name under 40 characters'),
  color: z.enum(LABEL_COLORS),
  description: z.string().trim().max(200, 'Keep the description under 200 characters'),
})

export type LabelFormValues = z.infer<typeof labelSchema>

export function defaultsForNewLabel(): LabelFormValues {
  return { name: '', color: 'neutral', description: '' }
}

export function toLabelInput(values: LabelFormValues): LabelInput {
  return {
    name: values.name.trim(),
    color: values.color,
    description: values.description.trim() || null,
  }
}

/** Whether a typed name is worth sending at all. */
export function isNameSendable(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= 40
}
