import { describeTyping } from './use-channel-realtime'

/**
 * "<Name> is typing" with three animated dots.
 *
 * The names come from the roster this client already holds, never from the
 * broadcast payload — a typing event carries a user id and nothing else, so
 * there is no name on the wire to forge.
 *
 * Reserves its own height whether or not anyone is typing, so the composer
 * does not jump as people start and stop.
 */
export function TypingIndicator({ names }: { names: readonly string[] }) {
  const label = describeTyping(names)

  return (
    <div className="text-muted-foreground text-2xs flex h-5 items-center gap-1.5 px-5">
      {label ? (
        <>
          {/* The only loop on screen, and the only continuous animation in
              the chat: three 4px dots, 2px of travel, 1.2s. Under reduced
              motion they stop moving and sit still instead. */}
          <span className="flex items-end gap-[3px] pb-[3px]" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="bg-muted-foreground/70 chat-typing-dot size-1 rounded-full"
                style={{ animationDelay: `${String(index * 0.15)}s` }}
              />
            ))}
          </span>
          <span aria-live="polite">{label}</span>
        </>
      ) : null}
    </div>
  )
}
