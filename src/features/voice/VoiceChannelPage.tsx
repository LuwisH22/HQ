import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Microphone, SpeakerHigh, Users, WarningCircle } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/states'
import { organizationService } from '@/services/organization.service'
import { voiceService } from '@/services/voice.service'
import type { Channel } from '@/services/channel.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'
import { useVoiceRoom } from './use-voice-room'
import { VoiceControlBar } from './VoiceControlBar'
import { VoiceParticipantRow } from './VoiceParticipantRow'

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

  // Leaving the page leaves the room. A voice connection that outlived its
  // page would be a microphone nobody can see they are holding.
  useEffect(() => {
    return () => {
      void voiceService.disconnect()
    }
  }, [channel.id])

  async function join(): Promise<void> {
    try {
      await voiceService.connect(channel.id)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border flex shrink-0 items-center gap-2.5 border-b px-4 py-3">
        <SpeakerHigh className="text-muted-foreground size-[18px] shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm leading-5 font-semibold">{channel.name}</h1>
          <p className="text-2xs text-muted-foreground truncate">
            {channel.topic ?? 'Voice channel'}
          </p>
        </div>

        <span
          data-voice-status={here ? voice.status : 'idle'}
          className={cn(
            'text-2xs flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1',
            status.tone === 'live'
              ? 'border-primary/50 text-foreground'
              : status.tone === 'warn'
                ? 'border-destructive/50 text-destructive'
                : 'border-border text-muted-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              status.tone === 'live'
                ? 'bg-primary'
                : status.tone === 'warn'
                  ? 'bg-destructive'
                  : 'bg-muted-foreground/50',
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
            <p className="text-3xs text-foreground/42 px-4 pt-4 pb-1 font-semibold tracking-[0.1em] uppercase">
              In this channel · {voice.participants.length}
            </p>
            <ul className="px-2 pb-4" aria-label={`People in ${channel.name}`}>
              {voice.participants.map((participant) => (
                <VoiceParticipantRow
                  key={participant.identity}
                  participant={participant}
                  avatarUrl={avatars.get(participant.identity) ?? null}
                />
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6">
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
                  <WarningCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  <span>{voice.error}</span>
                </p>
              ) : null}

              <Button loading={busy} aria-label="Join voice" onClick={() => void join()}>
                <Microphone aria-hidden="true" />
                {voice.status === 'error' && here ? 'Try again' : 'Join voice'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {inRoom ? (
        <div className="shrink-0">
          {voice.micBlocked && voice.error ? (
            <p
              role="status"
              className="border-border text-2xs text-muted-foreground flex items-start gap-1.5 border-t px-4 py-2 leading-relaxed"
            >
              <WarningCircle
                className="text-destructive mt-px size-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>{voice.error}</span>
            </p>
          ) : null}

          <VoiceControlBar
            micEnabled={voice.micEnabled}
            deafened={voice.deafened}
            onToggleMic={() => void voiceService.setMicrophoneEnabled(!voice.micEnabled)}
            onToggleDeafen={() => {
              voiceService.setDeafened(!voice.deafened)
            }}
            onLeave={() => void voiceService.disconnect()}
          />
        </div>
      ) : null}
    </div>
  )
}
