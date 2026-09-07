import { SpeakerHigh, SpeakerLow, SpeakerX } from '@phosphor-icons/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { voiceCommands } from '@/services/voice-session'
import { MAX_VOLUME, useVoiceStore } from '@/stores/voice.store'
import { cn } from '@/lib/utils'

/**
 * How loud one person is, to you.
 *
 * Behind a small button rather than beside every name: a row of sliders is a
 * mixing desk, and this is a list of people. The control appears on hover and
 * on focus, so it is reachable with a keyboard and never only with a mouse.
 *
 * A native range input on purpose — it arrives keyboard-operable, announced,
 * and draggable without a library, which is more than a custom track would be.
 */
export function ParticipantVolume({ identity, name }: { identity: string; name: string }) {
  const stored = useVoiceStore((state) => state.volumes[identity])
  const reset = useVoiceStore((state) => state.resetVolume)
  const volume = stored ?? MAX_VOLUME
  const percent = Math.round(volume * 100)

  const Icon = volume === 0 ? SpeakerX : volume < 0.5 ? SpeakerLow : SpeakerHigh

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Volume for ${name}, ${String(percent)} percent`}
          className={cn(
            'text-muted-foreground hover:text-foreground size-7 shrink-0 rounded-sm transition-opacity',
            // Quiet until wanted, but never hidden from a keyboard.
            'opacity-0 group-hover/participant:opacity-100 focus-visible:opacity-100',
            // Somebody deliberately turned down stays visible, or the setting
            // becomes invisible state.
            volume !== MAX_VOLUME && 'opacity-100',
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56 p-3">
        <p className="text-2xs text-muted-foreground mb-2 flex items-baseline gap-1.5 leading-tight">
          <span className="text-foreground min-w-0 flex-1 truncate font-medium">{name}</span>
          <span className="text-secondary-foreground shrink-0 font-mono tabular-nums">
            {percent}%
          </span>
        </p>

        {/* The track and its filled portion are boxes behind a transparent
            native range, so the control keeps the keyboard behaviour and the
            announcement a range arrives with. */}
        <div className="relative flex h-3 items-center">
          <span
            aria-hidden="true"
            className="bg-border absolute inset-x-0 h-0.5 overflow-hidden rounded-full"
          >
            <span
              className="bg-accent-text block h-full rounded-full"
              style={{ width: `${String(percent)}%` }}
            />
          </span>
          <input
            type="range"
            min={0}
            max={MAX_VOLUME * 100}
            step={5}
            value={percent}
            aria-label={`Volume for ${name}`}
            className="voice-slider relative"
            onChange={(event) => {
              void voiceCommands.setParticipantVolume(identity, Number(event.target.value) / 100)
            }}
          />
        </div>

        <p className="text-2xs text-muted-foreground mt-2 leading-relaxed">
          Only you hear this change. Nobody else is affected.
        </p>

        <button
          type="button"
          className="text-2xs text-muted-foreground hover:text-foreground mt-1.5 rounded-sm underline-offset-4 hover:underline"
          onClick={() => {
            // Applied first, forgotten second: the other order would write the
            // value straight back into the store it just cleared.
            void voiceCommands.setParticipantVolume(identity, MAX_VOLUME)
            reset(identity)
          }}
        >
          Reset to normal
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
