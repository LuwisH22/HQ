import { OrgMark } from '@/components/common/OrgMark'
import { cn } from '@/lib/utils'

/**
 * Shared frame for every unauthenticated screen.
 *
 * Two panes past 900px: the brand on the pit, the form on the canvas. The
 * form pane *is* the surface — there is no card, because a card floating on a
 * dark ground is the generic sign-in page this one is deliberately not.
 *
 * Below 900 it collapses to one column with the wordmark as a header strip,
 * which is the same composition standing up.
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
    <div className="bg-background flex min-h-dvh flex-col min-[900px]:flex-row">
      {/* --- Brand ---------------------------------------------------------
          The pit, which is where the wordmark belongs: it is the plane the
          sidebar uses, so the door and the room behind it are the same
          material. */}
      <div
        className={cn(
          'bg-sidebar border-border-subtle flex shrink-0 items-center gap-3 border-b px-4 py-5 sm:px-6',
          'min-[900px]:w-[55%] min-[900px]:flex-col min-[900px]:justify-center',
          'min-[900px]:border-r min-[900px]:border-b-0 min-[900px]:px-10 min-[900px]:py-10',
        )}
      >
        <OrgMark name="LFG" className="size-9 rounded-md min-[900px]:size-12" />
        <div className="min-w-0 min-[900px]:text-center">
          <p className="wordmark text-foreground text-[20px] leading-none min-[900px]:text-[28px]">
            LFG HQ
          </p>
          <p className="display-eyebrow text-3xs text-muted-foreground mt-1.5 min-[900px]:mt-2">
            Private organization workspace
          </p>
        </div>
      </div>

      {/* --- Form ----------------------------------------------------------
          The pane is the surface. Centred, and never wider than a form wants
          to be however much room the screen gives it. */}
      <div
        className={cn(
          'flex min-w-0 flex-1 items-start justify-center overflow-y-auto px-4 py-8 sm:px-6',
          'min-[900px]:items-center min-[900px]:px-10 min-[900px]:py-12',
          // A first-touch screen: wells and the primary action both at 40,
          // set once here rather than at every call site in the family.
          '[&_button[type=submit]]:h-10 [&_input]:h-10',
        )}
      >
        <div className="w-full max-w-[380px]">
          <div className="mb-6">
            <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.015em]">{title}</h1>
            {description ? (
              <p className="text-muted-foreground mt-1.5 text-sm">{description}</p>
            ) : null}
          </div>

          {children}

          {footer ? <div className="mt-5 text-sm">{footer}</div> : null}
        </div>
      </div>
    </div>
  )
}
