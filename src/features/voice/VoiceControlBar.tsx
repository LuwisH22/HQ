import {
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  SpeakerHigh,
  SpeakerSlash,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { VoiceSettingsMenu } from './VoiceSettingsMenu'

/**
 * Microphone, deafen, leave.
 *
 * Icon-first, square, and the system's 32px control — one step above the 28
 * the header and composer use, because these three are the page's only
 * actions. The label lives in the tooltip and in `aria-label`; the button
 * holds a glyph, because a row of three words is a form and this is a control.
 *
 * Leave is the only one with a colour of its own — it is the only one that
 * ends something — and it wears it as text rather than as a fill.
 */

const ACTION = 'size-8 rounded-sm [&_svg]:size-[18px]'

function ControlButton({
  label,
  active,
  destructive,
  disabled,
  onClick,
  children,
}: {
  label: string
  /** On, in the sense of "this state is doing something to you". */
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
            ACTION,
            destructive
              ? 'text-destructive hover:bg-destructive/10 px-0'
              : active
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/16'
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

export function VoiceControlBar({
  micEnabled,
  deafened,
  canSpeak,
  pushToTalk,
  onToggleMic,
  onToggleDeafen,
  onLeave,
}: {
  micEnabled: boolean
  deafened: boolean
  /** The server's answer. False draws no microphone, because there is none. */
  canSpeak: boolean
  pushToTalk: boolean
  onToggleMic: () => void
  onToggleDeafen: () => void
  onLeave: () => void
}) {
  return (
    <div
      className="border-border-subtle flex items-center gap-1 border-t px-3 py-2"
      role="group"
      aria-label="Voice controls"
    >
      {canSpeak ? (
        <ControlButton
          label={
            pushToTalk
              ? 'Push to talk is on — hold the key to speak'
              : micEnabled
                ? 'Mute microphone'
                : 'Unmute microphone'
          }
          active={!micEnabled}
          disabled={pushToTalk}
          onClick={onToggleMic}
        >
          {micEnabled ? <Microphone aria-hidden="true" /> : <MicrophoneSlash aria-hidden="true" />}
        </ControlButton>
      ) : null}

      <ControlButton
        label={deafened ? 'Undeafen' : 'Deafen'}
        active={deafened}
        onClick={onToggleDeafen}
      >
        {deafened ? <SpeakerSlash aria-hidden="true" /> : <SpeakerHigh aria-hidden="true" />}
      </ControlButton>

      <VoiceSettingsMenu canSpeak={canSpeak} />

      <div className="flex-1" />

      <ControlButton label="Leave voice" destructive onClick={onLeave}>
        <PhoneDisconnect aria-hidden="true" />
      </ControlButton>
    </div>
  )
}
