import { useEffect, useSyncExternalStore } from 'react'
import { Microphone, MicrophoneSlash, PhoneDisconnect, SpeakerHigh } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { voiceService } from '@/services/voice.service'
import type { Channel } from '@/services/channel.service'
import { errorMessage } from '@/lib/errors'

/**
 * Phase 4 · Voice — Step 1. The proof, not the product.
 *
 * Enough surface to show that the foundation holds: a token is requested, a
 * room is joined, a microphone is published, the connection state is legible,
 * and leaving actually leaves. The participant list, the speaking indicators,
 * the sidebar presence and the rest of the voice experience are Step 2; this
 * deliberately does not pre-empt any of them.
 *
 * There is no authorization logic here. The button asks the server, and the
 * server asks Postgres. What this page knows is whether the answer was yes.
 */

const LABEL: Record<string, string> = {
  idle: 'Not connected',
  requesting: 'Asking for access…',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Could not connect',
}

export function VoiceChannelPage({ channel }: { channel: Channel }) {
  const state = useSyncExternalStore(voiceService.subscribe, voiceService.getSnapshot)
  const here = state.status === 'connected' && state.channelId === channel.id

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
      <header className="border-border flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <SpeakerHigh className="text-muted-foreground size-[18px] shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="truncate text-sm leading-5 font-semibold">{channel.name}</h1>
          <p className="text-2xs text-muted-foreground truncate">
            {channel.topic ?? 'Voice channel'}
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div
          className="border-border bg-surface/40 w-full max-w-sm rounded-md border p-5"
          role="group"
          aria-label={`Voice in ${channel.name}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-3xs text-foreground/42 font-semibold tracking-[0.1em] uppercase">
              Voice
            </span>
            <Badge variant={here ? 'default' : 'secondary'} data-voice-status={state.status}>
              {LABEL[state.status] ?? state.status}
            </Badge>
          </div>

          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
            {here
              ? `${String(state.participantCount)} ${state.participantCount === 1 ? 'person' : 'people'} in the room.`
              : 'Audio runs over LiveKit. Access is decided by this channel’s own permissions, on the server, before a token is issued.'}
          </p>

          {state.error ? (
            <p className="text-destructive mt-3 text-xs leading-relaxed" role="status">
              {state.error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {here ? (
              <>
                <Button
                  variant="secondary"
                  aria-label={state.micEnabled ? 'Mute microphone' : 'Unmute microphone'}
                  aria-pressed={state.micEnabled}
                  onClick={() => void voiceService.setMicrophoneEnabled(!state.micEnabled)}
                >
                  {state.micEnabled ? (
                    <Microphone aria-hidden="true" />
                  ) : (
                    <MicrophoneSlash aria-hidden="true" />
                  )}
                  {state.micEnabled ? 'Mute' : 'Unmute'}
                </Button>
                <Button
                  variant="destructive"
                  aria-label="Leave voice"
                  onClick={() => void voiceService.disconnect()}
                >
                  <PhoneDisconnect aria-hidden="true" />
                  Leave
                </Button>
              </>
            ) : (
              <Button
                loading={state.status === 'requesting' || state.status === 'connecting'}
                aria-label="Join voice"
                onClick={() => void join()}
              >
                <Microphone aria-hidden="true" />
                Join voice
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
