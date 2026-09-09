import { formatDate } from '@/utils/datetime'

/**
 * "1 Oct 2026 – 30 Nov 2026", or one end of it, or nothing.
 *
 * A project with no dates is an ordinary project rather than one missing
 * something, so nothing is drawn for it and no placeholder stands in.
 */
export function dateRange(startDate: string | null, dueDate: string | null): string | null {
  if (startDate && dueDate) return `${formatDate(startDate)} – ${formatDate(dueDate)}`
  if (startDate) return `From ${formatDate(startDate)}`
  if (dueDate) return `Due ${formatDate(dueDate)}`
  return null
}
