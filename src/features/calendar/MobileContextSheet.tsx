import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate, m, useDragControls, useMotionValue, type PanInfo } from 'motion/react'
import { EASE_STANDARD } from './calendar-motion'
import type { SheetSnap } from './calendar-workspace-state'

/** What shows at the bottom of the screen while the grid has the rest: date, count, New. */
const PEEK_HEIGHT = 96

/**
 * The contextual panel, on a phone.
 *
 * The grid and the panel cannot share the width, so the panel becomes a sheet
 * over the bottom of the workspace with three places to rest: a peek that
 * shows the selected date and its count, half the screen for the rundown, and
 * the whole of it for an event, a form or a confirmation.
 *
 * Only the handle drags. The body scrolls, and a drag that started on a list
 * would fight the scroll for every finger. Releasing snaps to the nearest
 * rest, or the one the flick was heading for; dragging down from full while
 * a form is dirty asks first, through the same guard as everything else.
 *
 * The state model is the desktop's — the sheet only decides where the panel
 * sits, never what it shows.
 */
export function MobileContextSheet({
  snap,
  collapsible,
  reducedMotion,
  onSnap,
  onDismiss,
  children,
}: {
  snap: SheetSnap
  /** Only the day schedule may rest at peek or half; everything else is full. */
  collapsible: boolean
  reducedMotion: boolean
  onSnap: (snap: SheetSnap) => void
  /** Dragged down from a body that cannot collapse: go back one level. */
  onDismiss: () => void
  children: ReactNode
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const y = useMotionValue(0)
  const controls = useDragControls()

  // The sheet is as tall as the workspace; its resting places are offsets
  // from the top of that, so the height has to be measured rather than styled.
  useEffect(() => {
    const element = sheetRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
    observer.observe(element)
    setHeight(element.offsetHeight)
    return () => observer.disconnect()
  }, [])

  const offsets: Record<SheetSnap, number> = {
    full: 0,
    half: Math.round(height * 0.5),
    peek: Math.max(0, height - PEEK_HEIGHT),
  }

  useEffect(() => {
    if (height === 0) return
    const controlsHandle = animate(y, offsets[snap], {
      duration: reducedMotion ? 0 : 0.22,
      ease: EASE_STANDARD,
    })
    return () => controlsHandle.stop()
    // The offsets are derived from the height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, height, reducedMotion])

  function settle(_: PointerEvent | MouseEvent | TouchEvent, info: PanInfo): void {
    const current = y.get()
    const flick = Math.abs(info.velocity.y) > 300
    const downward = info.velocity.y > 0

    if (!collapsible) {
      // A form or a detail: the only way down is out.
      if (flick ? downward : current > height * 0.25) onDismiss()
      else void animate(y, 0, { duration: 0.16, ease: EASE_STANDARD })
      return
    }

    const order: SheetSnap[] = ['full', 'half', 'peek']
    let next: SheetSnap
    if (flick) {
      const index = order.indexOf(snap)
      next = order[Math.min(order.length - 1, Math.max(0, index + (downward ? 1 : -1)))] ?? snap
    } else {
      next = order.reduce((best, candidate) =>
        Math.abs(offsets[candidate] - current) < Math.abs(offsets[best] - current)
          ? candidate
          : best,
      )
    }
    if (next === snap) void animate(y, offsets[snap], { duration: 0.16, ease: EASE_STANDARD })
    else onSnap(next)
  }

  return (
    <m.div
      ref={sheetRef}
      style={{ y }}
      drag="y"
      dragListener={false}
      dragControls={controls}
      dragConstraints={{ top: 0, bottom: collapsible ? offsets.peek : 0 }}
      dragElastic={0.04}
      dragMomentum={false}
      onDragEnd={settle}
      className="bg-surface border-border-strong absolute inset-x-0 bottom-0 z-10 flex h-full flex-col rounded-t-xl border-t shadow-[0_-12px_32px_rgb(0_0_0/0.4)]"
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={
          collapsible
            ? snap === 'peek'
              ? 'Show the schedule'
              : 'Collapse the schedule'
            : 'Back to the schedule'
        }
        onPointerDown={(event) => controls.start(event)}
        onClick={() => {
          if (!collapsible) onDismiss()
          else onSnap(snap === 'peek' ? 'half' : 'peek')
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          if (!collapsible) onDismiss()
          else onSnap(snap === 'peek' ? 'half' : 'peek')
        }}
        className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      >
        <span className="bg-border-strong block h-1 w-8 rounded-full" aria-hidden="true" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </m.div>
  )
}
