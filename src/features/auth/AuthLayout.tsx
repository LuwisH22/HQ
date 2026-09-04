import { OrgMark } from '@/components/common/OrgMark'

/**
 * Shared frame for every unauthenticated screen.
 *
 * Deliberately quiet: a private tool's sign-in page should look like a locked
 * door, not a marketing page.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="bg-background flex min-h-dvh flex-col items-center justify-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-2.5">
          <OrgMark name="LFG" className="size-8" />
          <div>
            <p className="text-sm leading-tight font-semibold tracking-tight">LFG HQ</p>
            <p className="text-2xs text-muted-foreground">Private organization workspace</p>
          </div>
        </div>

        <div className="border-border bg-surface rounded-lg border p-6">
          <div className="mb-5 space-y-1.5">
            <h1 className="text-[20px] font-medium tracking-[-0.015em]">{title}</h1>
            {description ? (
              <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
            ) : null}
          </div>
          {children}
        </div>

        {footer ? <div className="mt-4 text-center text-xs">{footer}</div> : null}
      </div>
    </div>
  )
}
