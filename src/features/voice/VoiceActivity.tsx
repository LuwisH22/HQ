import { Microphone, MicrophoneSlash, SpeakerHigh } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initialsFor } from '@/services/profile.service'
import { voiceCommands } from '@/services/voice-session'
import type { Channel } from '@/services/channel.service'
import { cn } from '@/lib/utils'
import { useVoiceRoom } from './use-voice-room'

/**
 * Voice, in the channel panel's Activity section.
 *
 * A voice channel is a channel, so the panel that says what is happening in
 * one is where a call belongs — there is no second list in the sidebar for it.
 *
 * KNOWN LIMITATION — this shows the session *this browser* is in. Whether
 * somebody else is sitting in a voice channel you have not joined is presence,
 * and there is nowhere to read it from: LiveKit only tells participants who
 * else is in a room, and the alternatives are a server-side room query or
 * webhooks writing to Postgres. Both are infrastructure this correction was
 * asked not to add. So the row offers a way in and reports what it can
 * actually see, rather than guessing at a number.
 *
 * Nothing here is an authorization decision. The Join button asks the server,
 * and the server refuses a channel that is not yours in the same words it uses
 * for one that does not exist.
 */
export function VoiceActivity({
  channel,
  avatars,
}: {
  channel: Channel
  /** User id to avatar, from the roster the panel already holds. */
  avatars: Map<string, string | null>
}) {
  const voice = useVoiceRoom()
  const here = voice.channelId === channel.id
  const live = here && (voice.status === 'connected' || voice.status === 'reconnecting')

  return (
    <div className="px-4 py-1.5">
      <div className="flex items-start gap-2.5">
        <SpeakerHigh
          className={cn(
            'mt-px size-4 shrink-0',
            live ? 'text-accent-text' : 'text-muted-foreground',
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">Voice</p>
          <p className="text-2xs text-muted-foreground mt-0.5 font-mono">
            {live
              ? `${String(voice.participants.length)} connected · you are in`
              : 'No active session'}
          </p>
        </div>
      </div>

      {live ? (
        <ul className="mt-1.5 -ml-1" aria-label={`People in ${channel.name} voice`}>
          {voice.participants.map((participant) => (
            <li
              key={participant.identity}
              className="flex h-6 items-center gap-2 rounded-sm px-1"
              aria-label={`${participant.name}${participant.muted ? ', muted' : ''}`}
            >
              <span
                className={cn(
                  'shrink-0 rounded-[5px] p-px ring-[1.5px] transition-colors duration-[120ms]',
                  participant.speaking && !participant.muted
                    ? 'ring-accent-text'
                    : 'ring-transparent',
                )}
              >
                <Avatar className="size-5 rounded-sm">
                  {avatars.get(participant.identity) ? (
                    <AvatarImage src={avatars.get(participant.identity) ?? ''} alt="" />
                  ) : null}
                  <AvatarFallback className="rounded-sm text-[9px]">
                    {initialsFor({ displayName: participant.name })}
                  </AvatarFallback>
                </Avatar>
              </span>
              <span
                className="text-secondary-foreground min-w-0 flex-1 truncate text-xs"
                aria-hidden="true"
              >
                {participant.name}
              </span>
              {participant.muted ? (
                <MicrophoneSlash
                  className="text-muted-foreground size-3 shrink-0"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="mt-1.5 ml-6.5"
          aria-label={`Join voice in ${channel.name}`}
          loading={here && (voice.status === 'requesting' || voice.status === 'connecting')}
          onClick={() => void voiceCommands.connect(channel.id)}
        >
          <Microphone aria-hidden="true" />
          Join
        </Button>
      )}
    </div>
  )
}
