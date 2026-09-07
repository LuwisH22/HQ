import { GearSix } from '@phosphor-icons/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { voiceCommands } from '@/services/voice-session'
import { useVoiceStore, type InputMode } from '@/stores/voice.store'

/**
 * Voice settings, in the bar rather than in a settings page.
 *
 * They are settings you change during a call — whether to hold a key, whether
 * the microphone should suppress noise — so they live where the call is. All
 * of them are local preferences; none is sent anywhere, and none of them
 * decides whether a microphone is allowed at all, which is the server's
 * answer and appears above.
 */

const MODES: { value: InputMode; label: string; hint: string }[] = [
  {
    value: 'voice-activity',
    label: 'Voice activity',
    hint: 'Your microphone is open until you mute it.',
  },
  {
    value: 'push-to-talk',
    label: 'Push to talk',
    hint: 'Your microphone is closed until you hold the key.',
  },
]

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="block text-xs leading-tight">{label}</span>
        <span className="text-2xs text-muted-foreground block leading-tight">{hint}</span>
      </span>
    </label>
  )
}

export function VoiceSettingsMenu({ canSpeak }: { canSpeak: boolean }) {
  const inputMode = useVoiceStore((state) => state.inputMode)
  const pushToTalkKey = useVoiceStore((state) => state.pushToTalkKey)
  const processing = useVoiceStore((state) => state.audioProcessing)
  const activitySounds = useVoiceStore((state) => state.voiceActivitySoundsEnabled)
  const setActivitySounds = useVoiceStore((state) => state.setVoiceActivitySounds)

  return (
    <DropdownMenu>
      {/* No tooltip wrapper here on purpose: a TooltipTrigger and a
          DropdownMenuTrigger both claiming the same button fight over focus
          and dismissal, and a menu that will not close to Escape is worse
          than a button without a hover label. The name is on the button. */}
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Voice settings"
          className="text-muted-foreground hover:text-foreground size-8 rounded-sm [&_svg]:size-[18px]"
        >
          <GearSix aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-72 p-3">
        <fieldset className="border-0 p-0" disabled={!canSpeak}>
          <legend className="display-eyebrow text-3xs text-muted-foreground mb-1.5">Input</legend>

          {/* Menu radio items rather than buttons: they arrive with the right
              role, arrow-key navigation, and — the part that matters — they
              close the menu when one is chosen. */}
          <DropdownMenuRadioGroup
            value={inputMode}
            onValueChange={(value) => void voiceCommands.setInputMode(value as InputMode)}
          >
            {MODES.map((mode) => (
              <DropdownMenuRadioItem key={mode.value} value={mode.value} disabled={!canSpeak}>
                <span className="min-w-0">
                  <span className="block text-xs leading-tight font-medium">{mode.label}</span>
                  <span className="text-2xs text-muted-foreground block leading-tight">
                    {mode.hint}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          {inputMode === 'push-to-talk' ? (
            <p className="text-2xs text-muted-foreground mt-2 leading-relaxed">
              Hold{' '}
              <kbd className="border-border bg-surface text-foreground rounded-xs border px-1 py-px font-mono">
                {pushToTalkKey === 'Space' ? 'Space' : pushToTalkKey}
              </kbd>{' '}
              to talk. It is ignored while you are typing.
            </p>
          ) : null}
        </fieldset>

        <div className="border-border-subtle my-3 border-t" />

        <fieldset className="border-0 p-0" disabled={!canSpeak}>
          <legend className="display-eyebrow text-3xs text-muted-foreground mb-1">
            Microphone
          </legend>

          <Toggle
            label="Echo cancellation"
            hint="Stops the room hearing itself back."
            checked={processing.echoCancellation}
            onChange={(next) => void voiceCommands.setAudioProcessing({ echoCancellation: next })}
          />
          <Toggle
            label="Noise suppression"
            hint="Fans, keyboards, the street outside."
            checked={processing.noiseSuppression}
            onChange={(next) => void voiceCommands.setAudioProcessing({ noiseSuppression: next })}
          />
          <Toggle
            label="Automatic gain"
            hint="Evens out how close you sit to the microphone."
            checked={processing.autoGainControl}
            onChange={(next) => void voiceCommands.setAudioProcessing({ autoGainControl: next })}
          />

          <p className="text-2xs text-muted-foreground mt-2 leading-relaxed">
            Changing these replaces your microphone track. The call is not interrupted.
          </p>
        </fieldset>

        {canSpeak ? null : (
          <p className="text-2xs text-muted-foreground mt-3 leading-relaxed">
            You are listening only, so there is no microphone to set up.
          </p>
        )}

        <div className="border-border-subtle my-3 border-t" />

        {/* Outside the microphone fieldset on purpose: somebody who may only
            listen still hears people arrive, and the switch is theirs too. */}
        <fieldset className="border-0 p-0">
          <legend className="display-eyebrow text-3xs text-muted-foreground mb-1">Sounds</legend>

          <Toggle
            label="Join and leave chimes"
            hint="A short tone when somebody else enters or leaves the room."
            checked={activitySounds}
            onChange={setActivitySounds}
          />
        </fieldset>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
