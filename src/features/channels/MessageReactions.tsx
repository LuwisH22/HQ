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
 * A small fixed set rather than a full emoji keyboard.
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
}: {
  onPick: (emoji: string) => void
  label: string
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          className={cn('text-muted-foreground hover:text-foreground size-6', className)}
        >
          <Smiley className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto p-1">
        <div className="flex gap-0.5">
          {QUICK.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React with ${emoji}`}
              onClick={() => {
                onPick(emoji)
                setOpen(false)
              }}
              className={cn(
                'hover:bg-foreground/9 flex size-8 items-center justify-center rounded-sm text-base transition-colors',
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
            'flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors duration-[140ms]',
            'disabled:cursor-not-allowed disabled:opacity-60',
            reaction.mine
              ? 'border-primary bg-primary/14 text-foreground'
              : 'border-border text-muted-foreground hover:bg-foreground/7 hover:text-foreground',
          )}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          <span className="tabular-nums">{reaction.count}</span>
        </button>
      ))}

      {canReact ? (
        <ReactionPicker onPick={onPick} label="Add a reaction" className="size-6 rounded-full" />
      ) : null}
    </div>
  )
}
