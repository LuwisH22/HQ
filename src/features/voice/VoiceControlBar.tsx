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

/**
 * Microphone, deafen, leave.
 *
 * Icon-first, at the same 36px the composer's actions settled on, so the two
 * control rows in the product are the same size. The label lives in the
 * tooltip and in `aria-label`; the button holds a glyph, because a row of
 * three words is a form and this is a control.
 *
 * Leave is the only one with a colour of its own — it is the only one that
 * ends something.
 */

const ACTION = 'size-9 [&_svg]:size-[18px]'

function ControlButton({
  label,
  active,
  destructive,
  onClick,
  children,
}: {
  label: string
  /** On, in the sense of "this state is doing something to you". */
  active?: boolean
  destructive?: boolean
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
          onClick={onClick}
          className={cn(
            ACTION,
            destructive
              ? 'border-destructive/70 border px-0'
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

export function VoiceControlBar({
  micEnabled,
  deafened,
  onToggleMic,
  onToggleDeafen,
  onLeave,
}: {
  micEnabled: boolean
  deafened: boolean
  onToggleMic: () => void
  onToggleDeafen: () => void
  onLeave: () => void
}) {
  return (
    <div
      className="border-border flex items-center gap-1 border-t px-3 py-2.5"
      role="group"
      aria-label="Voice controls"
    >
      <ControlButton
        label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
        active={!micEnabled}
        onClick={onToggleMic}
      >
        {micEnabled ? <Microphone aria-hidden="true" /> : <MicrophoneSlash aria-hidden="true" />}
      </ControlButton>

      <ControlButton
        label={deafened ? 'Undeafen' : 'Deafen'}
        active={deafened}
        onClick={onToggleDeafen}
      >
        {deafened ? <SpeakerSlash aria-hidden="true" /> : <SpeakerHigh aria-hidden="true" />}
      </ControlButton>

      <div className="flex-1" />

      <ControlButton label="Leave voice" destructive onClick={onLeave}>
        <PhoneDisconnect aria-hidden="true" />
      </ControlButton>
    </div>
  )
}
