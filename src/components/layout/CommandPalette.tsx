import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { ArrowElbowDownLeft, MagnifyingGlass } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useWorkspace } from '@/hooks/use-workspace'
import { useUiStore } from '@/stores/ui.store'
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from './navigation'

/**
 * Ctrl/⌘+K launcher.
 *
 * Phase 1 searches navigation only. It is built as a result-list with a
 * keyboard-driven selection model so Phase 2 can add messages, people and
 * files as extra sections without reworking the interaction.
 */
export function CommandPalette() {
  const open = useUiStore((state) => state.commandPaletteOpen)
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen)
  const { permissions } = useWorkspace()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  useKeyboardShortcut({ key: 'k', mod: true, allowInInput: true }, () => setOpen(!open))

  const results = useMemo(() => {
    const available = NAV_ITEMS.filter(
      (item) => item.requires.length === 0 || permissions.canAny(item.requires),
    )
    const needle = query.trim().toLowerCase()
    if (!needle) return available
    return available.filter((item) => item.label.toLowerCase().includes(needle))
  }, [permissions, query])

  // Reset between openings so the palette never reopens mid-search.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveIndex(0)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function go(index: number) {
    const item = results[index]
    if (!item) return
    setOpen(false)
    void navigate(item.path)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (results.length === 0 ? 0 : (current + 1) % results.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      go(activeIndex)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showClose={false}
        className="top-[15vh] w-[min(512px,92vw)] max-w-none translate-y-0 gap-0 overflow-hidden rounded-lg p-0"
      >
        <VisuallyHidden>
          <DialogTitle>Search LFG HQ</DialogTitle>
          <DialogDescription>
            Jump to a section. Use the arrow keys to move and Enter to open.
          </DialogDescription>
        </VisuallyHidden>

        <div className="border-border flex items-center gap-2.5 border-b px-3.5">
          <MagnifyingGlass className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to…"
            aria-label="Search"
            aria-controls="command-results"
            aria-activedescendant={
              results[activeIndex] ? `command-${results[activeIndex].id}` : undefined
            }
            className="caret-primary placeholder:text-muted-foreground/70 h-11 flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        <ul
          ref={listRef}
          id="command-results"
          role="listbox"
          aria-label="Results"
          className="max-h-72 overflow-y-auto p-1.5"
        >
          {results.length === 0 ? (
            <li className="text-muted-foreground px-3 py-6 text-center text-sm">
              Nothing matches “{query}”.
            </li>
          ) : (
            results.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  id={`command-${item.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => go(index)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition-colors',
                    index === activeIndex
                      ? 'bg-surface-active text-foreground'
                      : 'text-secondary-foreground',
                  )}
                >
                  <item.icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                  {!item.shipped ? (
                    <span className="text-2xs text-muted-foreground ml-auto font-mono">soon</span>
                  ) : null}
                  {index === activeIndex ? (
                    <ArrowElbowDownLeft
                      className="text-muted-foreground ml-auto size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
