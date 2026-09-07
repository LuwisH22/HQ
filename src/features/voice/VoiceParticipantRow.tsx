import { MicrophoneSlash } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initialsFor } from '@/services/profile.service'
import type { VoiceParticipant } from '@/services/voice-session'
import { cn } from '@/lib/utils'
import { ParticipantVolume } from './ParticipantVolume'

/**
 * One person in the room.
 *
 * Speaking is a ring around the avatar and a word in the accessible label,
 * never colour alone — somebody who cannot see the ring is still told. The
 * ring is drawn on a fixed-size element so that appearing and disappearing
 * moves nothing.
 */
export function VoiceParticipantRow({
  participant,
  avatarUrl,
}: {
  participant: VoiceParticipant
  /** From the roster the app already holds; absent falls back to initials. */
  avatarUrl: string | null
}) {
  const { name, isLocal, speaking, muted } = participant
  const state = muted ? 'muted' : speaking ? 'speaking' : 'listening'

  return (
    <li
      data-participant-state={state}
      data-participant-local={isLocal || undefined}
      className="group/participant hover:bg-surface flex h-11 items-center gap-2.5 rounded-sm px-2 transition-colors duration-[120ms]"
      aria-label={`${name}${isLocal ? ' (you)' : ''}, ${
        muted ? 'muted' : speaking ? 'speaking' : 'not speaking'
      }`}
    >
      <span
        className={cn(
          // A fixed 2px ring at a 1px remove from the tile, only ever
          // recoloured: the box never changes size, so a burst of speech does
          // not nudge the list. No pulse, no halo — it is on or it is not.
          'shrink-0 rounded-[7px] p-px ring-2 transition-colors duration-[120ms]',
          speaking && !muted ? 'ring-accent-text' : 'ring-transparent',
        )}
      >
        <Avatar className="size-8 rounded-md">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback className="rounded-md">
            {initialsFor({ displayName: name })}
          </AvatarFallback>
        </Avatar>
      </span>

      <span className="min-w-0 flex-1 truncate" aria-hidden="true">
        <span
          className={cn(
            'truncate text-sm font-medium',
            speaking && !muted ? 'text-foreground' : 'text-secondary-foreground',
          )}
        >
          {name}
        </span>
        {isLocal ? (
          <span className="text-muted-foreground text-2xs ml-1.5 font-mono">you</span>
        ) : null}
      </span>

      {/* Muting is a glyph as well as a colour; speaking is the ring and the
          name's weight. Both are in the row's accessible name either way. */}
      {muted ? (
        <MicrophoneSlash className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
      ) : null}

      {/* Yours to set for other people, and meaningless for yourself: turning
          your own playback down would silence nothing you can hear. */}
      {isLocal ? null : <ParticipantVolume identity={participant.identity} name={name} />}
    </li>
  )
}
