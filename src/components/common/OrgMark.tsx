import { cn } from '@/lib/utils'

/**
 * Organization mark: the uploaded logo when there is one, otherwise a
 * monogram in an accent-outlined square. Nocturne has no gradients — the
 * outline is what carries the brand here.
 */
export function OrgMark({
  name,
  logoUrl,
  className,
}: {
  name: string
  logoUrl?: string | null
  className?: string
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn('size-7 shrink-0 rounded-sm object-cover', className)}
      />
    )
  }

  const monogram = name.trim().slice(0, 2).toUpperCase() || '??'

  return (
    <span
      aria-hidden="true"
      className={cn(
        'border-primary text-primary flex size-7 shrink-0 items-center justify-center rounded-sm border',
        'text-2xs font-semibold tracking-tight',
        className,
      )}
    >
      {monogram}
    </span>
  )
}
