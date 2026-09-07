import { useState } from 'react'
import { Smiley } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MessageReaction } from '@/services/message.service'
import { cn } from '@/lib/utils'

/**
 * The reaction chips under a message, and the picker that adds one.
 *
 * A chip is a toggle: pressing one you are already part of takes your
 * reaction back. `mine` is resolved from the rows themselves rather than
 * tracked separately, so it cannot drift from what the database holds.
 */

/**
 * A small fixed set rather than a full emoji keyboard. The composer's emoji
 * button opens this same menu, so there is one set of glyphs in the product
 * rather than two that could drift apart.
 *
 * Six people reacting to scrim calls do not need two thousand glyphs, and a
 * picker that fits in a dropdown is one less dependency and one less thing to
 * make work on a phone.
 */
const QUICK = ['👍', '🔥', '😂', '❤️', '👀', '🎯', '😮', '💀'] as const

export function ReactionPicker({
  onPick,
  label,
  className,
  onClose,
  itemLabel = (emoji) => `React with ${emoji}`,
}: {
  onPick: (emoji: string) => void
  label: string
  className?: string
  /**
   * What each glyph is called. The composer inserts rather than reacts, and a
   * screen reader should be told the difference.
   */
  itemLabel?: (emoji: string) => string
  /**
   * Called as the menu closes, before the focus goes back to the button.
   * Return true to say the focus has been put somewhere better — the composer
   * puts it back in the field, where the caret was. Under a message there is
   * nowhere better, so this is left off and the button keeps it.
   */
  onClose?: () => boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          className={cn('text-muted-foreground hover:text-foreground', className)}
        >
          <Smiley aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-auto p-1"
        onCloseAutoFocus={
          onClose
            ? (event) => {
                // The menu traps the focus until it is gone, so this is the
                // first moment anything else can have it.
                if (onClose()) event.preventDefault()
              }
            : undefined
        }
      >
        <div className="flex gap-0.5">
          {QUICK.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={itemLabel(emoji)}
              onClick={() => {
                onPick(emoji)
                setOpen(false)
              }}
              className={cn(
                'hover:bg-accent flex size-8 items-center justify-center rounded-sm text-base transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function MessageReactions({
  reactions,
  onToggle,
  onPick,
  canReact,
}: {
  reactions: readonly MessageReaction[]
  onToggle: (emoji: string, mine: boolean) => void
  onPick: (emoji: string) => void
  canReact: boolean
}) {
  if (reactions.length === 0) return null

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          disabled={!canReact}
          aria-pressed={reaction.mine}
          aria-label={`${reaction.emoji} ${String(reaction.count)}${reaction.mine ? ', including you' : ''}`}
          onClick={() => onToggle(reaction.emoji, reaction.mine)}
          className={cn(
            'flex h-6 items-center gap-1.5 rounded-sm border px-1.5 text-xs transition-colors duration-[120ms]',
            'disabled:cursor-not-allowed disabled:opacity-60',
            reaction.mine
              ? 'border-primary/30 bg-primary/14 text-foreground'
              : 'bg-elevated border-border-subtle text-secondary-foreground hover:border-border hover:text-foreground',
          )}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          <span className="text-2xs font-mono tabular-nums">{reaction.count}</span>
        </button>
      ))}

      {canReact ? (
        <ReactionPicker onPick={onPick} label="Add a reaction" className="size-6 rounded-sm" />
      ) : null}
    </div>
  )
}
