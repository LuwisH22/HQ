import { cn } from '@/lib/utils'

/**
 * Organization avatar: the uploaded logo when there is one, otherwise a
 * generated monogram so an org without branding still reads as itself.
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
        className={cn('size-7 shrink-0 rounded-md object-cover', className)}
      />
    )
  }

  const monogram = name.trim().slice(0, 2).toUpperCase() || '??'

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md',
        'from-primary to-signal bg-gradient-to-br',
        'text-2xs text-primary-foreground font-bold tracking-tight',
        className,
      )}
    >
      {monogram}
    </span>
  )
}
