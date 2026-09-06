import { MicrophoneSlash } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initialsFor } from '@/services/profile.service'
import type { VoiceParticipant } from '@/services/voice.service'
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
      className="group/participant hover:bg-foreground/4 flex h-10 items-center gap-2.5 rounded-sm px-2 transition-colors"
      aria-label={`${name}${isLocal ? ' (you)' : ''}, ${
        muted ? 'muted' : speaking ? 'speaking' : 'not speaking'
      }`}
    >
      <span
        className={cn(
          // A fixed 2px ring that is only ever recoloured: the box never
          // changes size, so a burst of speech does not nudge the list.
          'shrink-0 rounded-full ring-2 transition-colors duration-[120ms]',
          speaking && !muted ? 'ring-primary' : 'ring-transparent',
        )}
      >
        <Avatar className="size-7">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback>{initialsFor({ displayName: name })}</AvatarFallback>
        </Avatar>
      </span>

      <span className="min-w-0 flex-1 truncate text-sm leading-5" aria-hidden="true">
        {name}
        {isLocal ? <span className="text-muted-foreground/70 text-2xs ml-1.5">you</span> : null}
      </span>

      {muted ? (
        <MicrophoneSlash className="text-muted-foreground/70 size-4 shrink-0" aria-hidden="true" />
      ) : null}

      {/* Yours to set for other people, and meaningless for yourself: turning
          your own playback down would silence nothing you can hear. */}
      {isLocal ? null : <ParticipantVolume identity={participant.identity} name={name} />}
    </li>
  )
}
