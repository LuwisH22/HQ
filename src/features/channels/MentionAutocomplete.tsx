import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { MentionCandidate } from '@/services/channel.service'
import { initialsFor } from '@/services/profile.service'
import { cn } from '@/lib/utils'

/**
 * The `@` menu over the composer.
 *
 * It offers only people the channel would actually deliver a mention to —
 * the list comes from `channel_member_ids`, resolved in Postgres through the
 * same rules that govern the channel — so a private channel does not become a
 * way to enumerate the organization.
 *
 * Nothing here decides anything. Typing a name that is not offered still
 * sends plain text; the trigger resolves the mention server-side either way.
 */

export function MentionAutocomplete({
  candidates,
  term,
  activeIndex,
  onPick,
  onHover,
}: {
  candidates: readonly MentionCandidate[]
  term: string
  activeIndex: number
  onPick: (candidate: MentionCandidate) => void
  onHover: (index: number) => void
}) {
  if (candidates.length === 0) return null

  return (
    <div
      className="border-border bg-popover absolute bottom-full left-0 z-30 mb-1 w-[min(320px,100%)] overflow-hidden rounded-md border shadow-lg"
      role="listbox"
      aria-label="Mention a member"
    >
      <p className="display-eyebrow text-3xs text-muted-foreground border-border-subtle border-b px-3 py-1.5">
        {term === '' ? 'Members' : `Matching “${term}”`}
      </p>
      <ul className="max-h-56 overflow-y-auto py-1">
        {candidates.map((candidate, index) => (
          <li key={candidate.userId}>
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              // The handle, not the whole row: read aloud, the initials in the
              // avatar are the name again with the letters removed.
              aria-label={`${candidate.handle}, ${candidate.roleName}`}
              data-handle={candidate.handle}
              // The composer keeps focus; the menu is driven from its keyboard
              // handler, so this must not steal it on the way down.
              onMouseDown={(event) => {
                event.preventDefault()
                onPick(candidate)
              }}
              onMouseEnter={() => onHover(index)}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
                index === activeIndex ? 'bg-surface-active' : 'hover:bg-accent',
              )}
            >
              <Avatar className="size-6 shrink-0 rounded-sm" aria-hidden="true">
                {candidate.avatarUrl ? <AvatarImage src={candidate.avatarUrl} alt="" /> : null}
                <AvatarFallback className="rounded-sm">
                  {initialsFor({ displayName: candidate.displayName })}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs leading-tight font-medium">
                  {candidate.handle}
                </span>
                <span className="text-2xs text-muted-foreground block truncate">
                  {candidate.roleName}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
