import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Ear,
  Microphone,
  SpeakerHigh,
  SpeakerSlash,
  Users,
  WarningCircle,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/states'
import { organizationService } from '@/services/organization.service'
import { voiceCommands } from '@/services/voice-session'
import type { Channel } from '@/services/channel.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'
import { useVoiceRoom } from './use-voice-room'
import { VoiceControlBar } from './VoiceControlBar'
import { VoiceParticipantRow } from './VoiceParticipantRow'
import { VoiceActivityFeed } from './VoiceActivity'
import { useVoiceActivity } from './use-voice-activity'

/**
 * A voice channel.
 *
 * The room is the page: who is in it, who is talking, and the three things
 * you can do about it. There is no timeline, no composer and no thread panel
 * — a voice channel is not a quiet text channel, and rendering one as if it
 * were would load a conversation that cannot exist.
 *
 * Nothing here is polled. The participant list is LiveKit's, rebuilt on its
 * own events; the only Supabase read is the organization roster the app
 * already holds, used to put a face on an identity.
 */

const STATUS: Record<string, { label: string; tone: 'quiet' | 'live' | 'warn' }> = {
  idle: { label: 'Not connected', tone: 'quiet' },
  requesting: { label: 'Asking for access…', tone: 'quiet' },
  connecting: { label: 'Connecting…', tone: 'quiet' },
  connected: { label: 'Connected', tone: 'live' },
  reconnecting: { label: 'Reconnecting…', tone: 'warn' },
  error: { label: 'Connection failed', tone: 'warn' },
}

/**
 * The activity eyebrow and its feed, together.
 *
 * The heading only exists when there is something under it: a section that
 * says ACTIVITY over nothing is a promise the room has not made yet.
 */
function VoiceActivityBlock({
  channelId,
  channelName,
}: {
  channelId: string
  channelName: string
}) {
  const events = useVoiceActivity()
  if (!events.some((event) => event.channelId === channelId)) return null

  return (
    <div className="pb-4">
      <p className="display-eyebrow text-3xs text-muted-foreground px-4 pt-4 pb-1.5">Activity</p>
      <VoiceActivityFeed channelId={channelId} channelName={channelName} className="px-4" />
    </div>
  )
}

export function VoiceChannelPage({ channel }: { channel: Channel }) {
  const voice = useVoiceRoom()
  const { organization } = useWorkspace()
  const organizationId = organization?.id

  const here = voice.channelId === channel.id
  const inRoom = here && (voice.status === 'connected' || voice.status === 'reconnecting')
  const busy = here && (voice.status === 'requesting' || voice.status === 'connecting')
  const status = STATUS[here ? voice.status : 'idle'] ?? STATUS.idle!

  // The roster the sidebar and the member list already loaded. An identity is
  // a user id, and this is what turns it into a face.
  const membersQuery = useQuery({
    queryKey: queryKeys.members.all(organizationId ?? 'none'),
    queryFn: () => organizationService.listMembers(organizationId as string),
    enabled: Boolean(organizationId),
    staleTime: 5 * 60_000,
  })

  const avatars = useMemo(() => {
    const byUser = new Map<string, string | null>()
    for (const member of membersQuery.data ?? []) {
      byUser.set(member.userId, member.profile.avatarUrl)
    }
    return byUser
  }, [membersQuery.data])

  // Deliberately no cleanup here. The session belongs to the application, not
  // to this page: navigating to Settings and back should find the same call,
  // not a second one. A page unmount is not a Leave, and the persistent bar in
  // the shell is what makes that visible while you are elsewhere.

  async function join(): Promise<void> {
    try {
      await voiceCommands.connect(channel.id)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The chat header's sibling: one line, 48 tall, the same hierarchy.
          The speaker takes the accent while the room is live, which is the
          same thing the hash does in a text channel. */}
      <header className="border-border-subtle flex h-12 shrink-0 items-center gap-2 border-b px-4 sm:px-5">
        <SpeakerHigh
          className={cn('size-4 shrink-0', inRoom ? 'text-accent-text' : 'text-muted-foreground')}
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="min-w-0 shrink-0 truncate text-[15px] leading-none font-semibold">
            {channel.name}
          </h1>
          <span className="text-muted-foreground/50 hidden shrink-0 sm:inline" aria-hidden="true">
            ·
          </span>
          <p className="text-muted-foreground hidden truncate text-sm sm:block">
            {channel.topic ?? 'Voice channel'}
          </p>
        </div>

        {/* A dot and a word in mono, not a badge: the state is metadata about
            the room, and every state wearing a coloured pill would flatten
            the difference between them. */}
        <span
          data-voice-status={here ? voice.status : 'idle'}
          className={cn(
            'text-2xs flex shrink-0 items-center gap-1.5 font-mono',
            status.tone === 'warn' ? 'text-warning' : 'text-muted-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              status.tone === 'live'
                ? 'bg-success'
                : status.tone === 'warn'
                  ? 'bg-warning'
                  : 'bg-offline',
            )}
          />
          {status.label}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {inRoom ? (
          <div className="max-w-md">
            {/* Held to a reading width rather than stretched: a muted icon at
                the far end of a wide screen no longer belongs to the name it
                describes. */}
            <p className="display-eyebrow text-3xs text-muted-foreground flex items-baseline gap-1.5 px-4 pt-4 pb-1">
              In this channel
              <span className="font-mono tabular-nums">{voice.participants.length}</span>
            </p>
            <ul className="px-2" aria-label={`People in ${channel.name}`}>
              {voice.participants.map((participant) => (
                <VoiceParticipantRow
                  key={participant.identity}
                  participant={participant}
                  avatarUrl={avatars.get(participant.identity) ?? null}
                />
              ))}
            </ul>

            {/* What has happened in the room since you joined it. */}
            <VoiceActivityBlock channelId={channel.id} channelName={channel.name} />
          </div>
        ) : (
          <div className="flex min-h-full flex-col">
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="w-full max-w-sm text-center">
                <EmptyState
                  icon={Users}
                  title={channel.name}
                  description={
                    voice.status === 'error' && here
                      ? 'Something went wrong connecting. Try again.'
                      : 'Nobody can hear you until you join. Access is decided by this channel’s own permissions, on the server.'
                  }
                  className="border-0"
                />

                {voice.status === 'error' && here && voice.error ? (
                  <p
                    role="status"
                    className="text-destructive mx-auto mb-3 flex max-w-xs items-start justify-center gap-1.5 text-xs leading-relaxed"
                  >
                    <WarningCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>{voice.error}</span>
                  </p>
                ) : null}

                <Button loading={busy} aria-label="Join voice" onClick={() => void join()}>
                  <Microphone aria-hidden="true" />
                  {voice.status === 'error' && here ? 'Try again' : 'Join voice'}
                </Button>
              </div>
            </div>

            {/* What happened while you were in here, if you have been. It
                outlives the session that recorded it: the last thing the log
                says is that you left, and that is worth seeing. */}
            <VoiceActivityBlock channelId={channel.id} channelName={channel.name} />
          </div>
        )}
      </div>

      {inRoom ? (
        <div className="shrink-0">
          {!voice.canSpeak ? (
            <p
              role="status"
              className="border-border-subtle text-2xs text-muted-foreground flex items-start gap-1.5 border-t px-4 py-2 leading-relaxed"
            >
              <Ear className="text-accent-text mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>
                You are listening only. Speaking in this channel needs the “Speak in voice”
                permission.
              </span>
            </p>
          ) : null}

          {voice.audioBlocked ? (
            <div
              role="status"
              className="border-border-subtle bg-surface text-2xs text-secondary-foreground flex items-center gap-2 border-t px-4 py-2 leading-relaxed"
            >
              <SpeakerSlash className="text-warning size-3.5 shrink-0" aria-hidden="true" />
              <span className="flex-1">Your browser is not letting this tab play sound yet.</span>
              {/* The one place on this page the accent fills a shape: it is
                  the only thing standing between you and hearing anybody. */}
              <Button
                size="sm"
                aria-label="Enable audio"
                onClick={() => void voiceCommands.unblockAudio()}
              >
                Enable audio
              </Button>
            </div>
          ) : null}

          {voice.micBlocked && voice.error ? (
            <p
              role="status"
              className="border-border-subtle text-2xs text-muted-foreground flex items-start gap-1.5 border-t px-4 py-2 leading-relaxed"
            >
              <WarningCircle className="text-warning mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>{voice.error}</span>
            </p>
          ) : null}

          <VoiceControlBar
            micEnabled={voice.micEnabled}
            deafened={voice.deafened}
            canSpeak={voice.canSpeak}
            pushToTalk={voice.pushToTalk}
            onToggleMic={() => void voiceCommands.setMicrophoneEnabled(!voice.micEnabled)}
            onToggleDeafen={() => void voiceCommands.setDeafened(!voice.deafened)}
            onLeave={() => void voiceCommands.disconnect()}
          />
        </div>
      ) : null}
    </div>
  )
}
