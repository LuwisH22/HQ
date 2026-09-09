import { useState } from 'react'
import { Plus, Trash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormFailure } from '@/components/common/FormFailure'
import type { Label } from '@/services/label.service'
import type { LabelColor } from '@/types/database.types'
import { cn } from '@/lib/utils'
import { LABEL_COLORS, LABEL_COLOR_LABELS, LABEL_DOT_TONE } from './label-colors'
import type { useLabelMutations } from './use-labels'

/**
 * The project's labels, in one compact list.
 *
 * A row each: a colour, a name you can type over, and a way to remove it.
 * Deliberately not a management screen — a label is a word and a tone, and
 * anything more elaborate would be a product of its own.
 *
 * Removing one takes it off every task it was on and touches nothing else.
 */
export function LabelManagerDialog({
  open,
  onOpenChange,
  labels,
  mutations,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  labels: Label[]
  mutations: ReturnType<typeof useLabelMutations>
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<LabelColor>('neutral')
  const { create, update, remove } = mutations

  const add = () => {
    const trimmed = name.trim()
    if (trimmed === '') return
    create.mutate(
      { name: trimmed, color },
      {
        onSuccess: () => {
          setName('')
          setColor('neutral')
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return
        create.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="top-3 flex max-h-[92dvh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-1/2 sm:max-h-[88dvh] sm:max-w-md sm:-translate-y-1/2">
        <div className="border-border-subtle shrink-0 border-b px-5 py-4">
          <p className="display-eyebrow text-3xs text-muted-foreground">Projects</p>
          <DialogTitle className="mt-1 text-[15px]">Labels</DialogTitle>
          <DialogDescription className="mt-1">
            Words for the work on this project. Removing one takes it off every task.
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <FormFailure
            error={create.isError ? create.error : update.isError ? update.error : null}
          />

          <ul className="divide-border-subtle divide-y">
            {labels.map((label) => (
              <LabelRow
                key={label.id}
                label={label}
                onRename={(next) => {
                  update.mutate({ labelId: label.id, input: { name: next, color: label.color } })
                }}
                onRecolor={(next) => {
                  update.mutate({ labelId: label.id, input: { name: label.name, color: next } })
                }}
                onRemove={() => {
                  remove.mutate(label.id)
                }}
                busy={update.isPending || remove.isPending}
              />
            ))}
          </ul>

          {labels.length === 0 ? (
            <p className="text-muted-foreground/70 text-xs">No labels yet.</p>
          ) : null}

          <div className="border-border-subtle flex items-end gap-2 border-t pt-3">
            <div className="min-w-0 flex-1">
              <Input
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    add()
                  }
                }}
                placeholder="New label"
                aria-label="New label"
                maxLength={40}
                className="h-8 text-xs"
              />
            </div>
            <ColorSelect value={color} onChange={setColor} />
            <Button
              size="sm"
              className="h-8"
              loading={create.isPending}
              disabled={name.trim() === ''}
              onClick={add}
            >
              <Plus aria-hidden="true" />
              Add
            </Button>
          </div>
        </div>

        <div className="border-border-subtle bg-elevated flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false)
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LabelRow({
  label,
  onRename,
  onRecolor,
  onRemove,
  busy,
}: {
  label: Label
  onRename: (name: string) => void
  onRecolor: (color: LabelColor) => void
  onRemove: () => void
  busy: boolean
}) {
  const [draft, setDraft] = useState(label.name)

  return (
    <li className="flex items-center gap-2 py-2">
      <ColorSelect value={label.color} onChange={onRecolor} />
      <Input
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onBlur={() => {
          const next = draft.trim()
          if (next !== '' && next !== label.name) onRename(next)
          else setDraft(label.name)
        }}
        maxLength={40}
        aria-label={`Rename ${label.name}`}
        className="h-7 min-w-0 flex-1 text-xs"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-destructive size-7"
        aria-label={`Delete ${label.name}`}
        disabled={busy}
        onClick={onRemove}
      >
        <Trash className="size-3.5" aria-hidden="true" />
      </Button>
    </li>
  )
}

/** The six, as a swatch and a word. Never a colour somebody typed. */
function ColorSelect({
  value,
  onChange,
}: {
  value: LabelColor
  onChange: (color: LabelColor) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        onChange(next as LabelColor)
      }}
    >
      <SelectTrigger className="h-7 w-28 shrink-0 text-xs" aria-label="Label colour">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LABEL_COLORS.map((color) => (
          <SelectItem key={color} value={color}>
            <span className="flex items-center gap-2">
              <span
                className={cn('size-2 rounded-full', LABEL_DOT_TONE[color])}
                aria-hidden="true"
              />
              {LABEL_COLOR_LABELS[color]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
