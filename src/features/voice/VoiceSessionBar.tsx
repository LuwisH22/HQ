import { Link } from 'react-router-dom'
import {
  ArrowClockwise,
  Ear,
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  SpeakerHigh,
  SpeakerSimpleX,
  SpeakerSlash,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { voiceCommands } from '@/services/voice-session'
import type { VoiceState } from '@/services/voice-session'
import { cn } from '@/lib/utils'
import { useVoiceRoom } from './use-voice-room'
import { useChannelDirectory } from '@/features/channels/use-channels'

/**
 * The call, wherever you are.
 *
 * A voice session belongs to the application rather than to the page that
 * started it, so this is how it stays visible after you have gone to look at
 * something else. It renders twice — once above the sidebar's profile footer,
 * once above the phone's tab bar — and both are the same session read twice,
 * never two of anything.
 *
 * It knows nothing about LiveKit. It reads a snapshot and calls the same
 * commands the voice page calls, which is why Leave means the same thing in
 * both places.
 */

function statusLine(voice: VoiceState): string {
  if (voice.status === 'connecting' || voice.status === 'requesting') return 'Connecting…'
  if (voice.status === 'reconnecting') return 'Reconnecting…'
  if (voice.status === 'error') return 'Connection failed'
  if (!voice.canSpeak) return 'Listening'

  const count = voice.participants.length
  return `${String(count)} connected`
}

function BarButton({
  label,
  active,
  destructive,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant={destructive ? 'destructive' : 'ghost'}
          aria-label={label}
          aria-pressed={destructive ? undefined : Boolean(active)}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'size-7 px-0 [&_svg]:size-4',
            destructive
              ? 'border-destructive/70 border'
              : active
                ? 'bg-destructive/14 text-destructive hover:bg-destructive/20'
                : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * @param layout `sidebar` stacks; `bar` is one line, for the phone.
 */
export function VoiceSessionBar({ layout = 'sidebar' }: { layout?: 'sidebar' | 'bar' }) {
  const voice = useVoiceRoom()
  const directory = useChannelDirectory()

  // Nothing at all when there is no call: this is a status, not a control.
  if (voice.status === 'idle' || voice.channelId === null) return null

  const channel = directory.channels.find((c) => c.id === voice.channelId)
  const name = voice.channelName ?? channel?.name ?? 'Voice'
  const failed = voice.status === 'error'
  const live = voice.status === 'connected'

  const controls = (
    <>
      {voice.canSpeak ? (
        <BarButton
          label={
            voice.pushToTalk
              ? 'Push to talk is on — hold the key to speak'
              : voice.micEnabled
                ? 'Mute microphone'
                : 'Unmute microphone'
          }
          active={!voice.micEnabled}
          disabled={voice.pushToTalk || !live}
          onClick={() => void voiceCommands.setMicrophoneEnabled(!voice.micEnabled)}
        >
          {voice.micEnabled ? (
            <Microphone aria-hidden="true" />
          ) : (
            <MicrophoneSlash aria-hidden="true" />
          )}
        </BarButton>
      ) : null}

      {failed ? (
        <BarButton
          label="Try connecting again"
          onClick={() => void voiceCommands.connect(voice.channelId as string)}
        >
          <ArrowClockwise aria-hidden="true" />
        </BarButton>
      ) : (
        <BarButton
          label={voice.deafened ? 'Undeafen' : 'Deafen'}
          active={voice.deafened}
          disabled={!live}
          onClick={() => void voiceCommands.setDeafened(!voice.deafened)}
        >
          {voice.deafened ? (
            <SpeakerSlash aria-hidden="true" />
          ) : (
            <SpeakerHigh aria-hidden="true" />
          )}
        </BarButton>
      )}

      {voice.audioBlocked ? (
        <BarButton
          label="Enable audio — your browser is not letting this tab play sound"
          onClick={() => void voiceCommands.unblockAudio()}
        >
          <SpeakerSimpleX aria-hidden="true" />
        </BarButton>
      ) : null}

      <BarButton label="Leave voice" destructive onClick={() => void voiceCommands.disconnect()}>
        <PhoneDisconnect aria-hidden="true" />
      </BarButton>
    </>
  )

  const where = channel ? (
    <Link
      to={`/channels/${channel.key}`}
      className="focus-visible:ring-ring truncate rounded-sm text-xs leading-tight font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
    >
      {name}
    </Link>
  ) : (
    <span className="truncate text-xs leading-tight font-medium">{name}</span>
  )

  if (layout === 'bar') {
    return (
      <div
        role="region"
        aria-label="Voice session"
        data-voice-bar="mobile"
        className="border-border bg-surface flex items-center gap-2 border-t px-3 py-1.5 md:hidden"
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            failed ? 'bg-destructive' : live ? 'bg-primary' : 'bg-muted-foreground/60',
          )}
        />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          {where}
          <span className="text-2xs text-muted-foreground truncate">{statusLine(voice)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">{controls}</span>
      </div>
    )
  }

  return (
    <div
      role="region"
      aria-label="Voice session"
      data-voice-bar="sidebar"
      className="border-border bg-surface/60 mx-2 mb-2 rounded-md border p-2"
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            failed ? 'bg-destructive' : live ? 'bg-primary' : 'bg-muted-foreground/60',
          )}
        />
        <span className="text-3xs text-foreground/42 font-semibold tracking-[0.1em] uppercase">
          Voice
        </span>
        {!voice.canSpeak && live ? (
          <Ear className="text-muted-foreground/60 ml-auto size-3.5" aria-label="Listening only" />
        ) : null}
      </div>

      <div className="mt-0.5 flex flex-col">
        {where}
        <span className="text-2xs text-muted-foreground truncate">{statusLine(voice)}</span>
      </div>

      <div className="mt-2 flex items-center gap-1">{controls}</div>
    </div>
  )
}
