import { useState } from 'react'
import { Check, Plus, Tag } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Label } from '@/services/label.service'
import { cn } from '@/lib/utils'
import { LABEL_DOT_TONE } from './label-colors'

/**
 * Putting labels on a task, and making one when the right label is missing.
 *
 * Compact on purpose: a menu of what the project has, a tick beside what is
 * already on this task, and one line at the bottom for a name nobody has used
 * yet. A label manager is a different screen, and this is not it.
 */
export function LabelPicker({
  labels,
  selected,
  onToggle,
  onCreate,
  canManage,
  busy = false,
}: {
  labels: Label[]
  /** The ids already on the task. */
  selected: Set<string>
  onToggle: (label: Label, isOn: boolean) => void
  onCreate: (name: string) => void
  canManage: boolean
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const term = search.trim().toLowerCase()
  const shown = term ? labels.filter((one) => one.name.toLowerCase().includes(term)) : labels
  const exists = labels.some((one) => one.name.trim().toLowerCase() === term)

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="text-2xs h-6" disabled={busy}>
          <Plus aria-hidden="true" />
          Label
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Labels</DropdownMenuLabel>

        {labels.length > 4 ? (
          <div className="px-1.5 pb-1.5">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
              }}
              placeholder="Find a label"
              className="h-7 text-xs"
              aria-label="Find a label"
            />
          </div>
        ) : null}

        {shown.length === 0 && labels.length > 0 ? (
          <p className="text-muted-foreground/70 px-2 py-2 text-xs">Nothing by that name.</p>
        ) : null}

        {labels.length === 0 ? (
          <p className="text-muted-foreground/70 px-2 py-2 text-xs">
            This project has no labels yet.
          </p>
        ) : null}

        {shown.map((label) => {
          const isOn = selected.has(label.id)
          return (
            <DropdownMenuItem
              key={label.id}
              onSelect={(event) => {
                // Kept open: putting three labels on a task should be three
                // clicks, not three trips back to the button.
                event.preventDefault()
                onToggle(label, isOn)
              }}
            >
              <span
                className={cn('size-2 shrink-0 rounded-full', LABEL_DOT_TONE[label.color])}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{label.name}</span>
              {isOn ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          )
        })}

        {canManage && term.length > 0 && !exists ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                onCreate(search.trim())
                setSearch('')
              }}
            >
              <Tag className="size-3" aria-hidden="true" />
              <span className="truncate">Create “{search.trim()}”</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
