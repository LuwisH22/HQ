import { Microphone, SpeakerHigh } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initialsFor } from '@/services/profile.service'
import { voiceCommands } from '@/services/voice-session'
import type { Channel } from '@/services/channel.service'
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
    <div className="flex items-start gap-2.5 px-4 py-1.5">
      <SpeakerHigh className="text-muted-foreground/60 mt-px size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-tight font-medium">Voice</p>

        {live ? (
          <>
            <p className="text-2xs text-muted-foreground/70 mt-0.5 leading-relaxed">
              {voice.participants.length} {voice.participants.length === 1 ? 'person' : 'people'} in
              voice · you are connected
            </p>
            <ul
              className="mt-1.5 flex flex-wrap gap-1"
              aria-label={`People in ${channel.name} voice`}
            >
              {voice.participants.map((participant) => (
                <li key={participant.identity}>
                  <Avatar className="size-6" title={participant.name}>
                    {avatars.get(participant.identity) ? (
                      <AvatarImage src={avatars.get(participant.identity) ?? ''} alt="" />
                    ) : null}
                    <AvatarFallback>
                      {initialsFor({ displayName: participant.name })}
                    </AvatarFallback>
                  </Avatar>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="text-2xs text-muted-foreground/70 mt-0.5 leading-relaxed">
              No active voice session here.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-1.5"
              aria-label={`Join voice in ${channel.name}`}
              loading={here && (voice.status === 'requesting' || voice.status === 'connecting')}
              onClick={() => void voiceCommands.connect(channel.id)}
            >
              <Microphone aria-hidden="true" />
              Join
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
