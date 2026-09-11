import type { Transition, Variants } from 'motion/react'
import type { GridDirection, PanelTransition } from './calendar-workspace-state'

/**
 * How the calendar moves.
 *
 * One easing family and four durations, from the design system: nothing here
 * takes longer than 220ms, nothing scales, nothing overshoots. Every value is
 * `opacity` or `transform`, which is what keeps this off the main thread.
 *
 * Reduced motion removes every translate and every stagger; what is left is
 * an 80ms fade in, and nothing on the way out. See the audit, §C.
 */

export const EASE_STANDARD = [0.2, 0, 0, 1] as const
export const EASE_EXIT = [0.4, 0, 1, 1] as const

/** Sixteen milliseconds between rundown rows, and never more than six of them. */
export const STAGGER_STEP = 0.016
export const STAGGER_CAP = 5

const PANEL_SHIFT: Record<PanelTransition, { in: [number, number]; out: [number, number] }> = {
  // Deeper slides in from the right and leaves to the left; back is the mirror.
  deeper: { in: [6, 0], out: [-4, 0] },
  back: { in: [-6, 0], out: [4, 0] },
  // A new thing on the same day rises rather than arriving from the side.
  lateral: { in: [0, 4], out: [0, -4] },
  none: { in: [0, 0], out: [0, 0] },
}

/** The panel body: an 80ms exit, then a 120ms entrance from 6px away. */
export function panelBodyVariants(reduced: boolean): Variants {
  return {
    enter: (transition: PanelTransition) => ({
      opacity: 0,
      x: reduced ? 0 : PANEL_SHIFT[transition].in[0],
      y: reduced ? 0 : PANEL_SHIFT[transition].in[1],
    }),
    center: {
      opacity: 1,
      x: 0,
      y: 0,
      transition: { duration: reduced ? 0.08 : 0.12, ease: EASE_STANDARD },
    },
    exit: (transition: PanelTransition) => ({
      opacity: 0,
      x: reduced ? 0 : PANEL_SHIFT[transition].out[0],
      y: reduced ? 0 : PANEL_SHIFT[transition].out[1],
      transition: { duration: reduced ? 0 : 0.08, ease: EASE_EXIT },
    }),
  }
}

/**
 * The grid turning over a month or a week: an 8px slide in the direction of
 * travel. Jumping to today is a teleport, not a step, and only fades.
 */
export function gridVariants(reduced: boolean): Variants {
  return {
    enter: (direction: GridDirection) => ({ opacity: 0, x: reduced ? 0 : 8 * direction }),
    center: {
      opacity: 1,
      x: 0,
      transition: { duration: reduced ? 0.08 : 0.16, ease: EASE_STANDARD },
    },
    exit: (direction: GridDirection) => ({
      opacity: 0,
      x: reduced ? 0 : -8 * direction,
      transition: { duration: reduced ? 0 : 0.08, ease: EASE_EXIT },
    }),
  }
}

/** A rundown row arriving: 120ms, 4px up, staggered by its place in the list. */
export function rowEntrance(index: number, reduced: boolean): Transition {
  return {
    duration: reduced ? 0.08 : 0.12,
    ease: EASE_STANDARD,
    delay: reduced ? 0 : Math.min(index, STAGGER_CAP) * STAGGER_STEP,
  }
}

/** Layout shifts — a row appearing above another — take the layout duration. */
export function layoutTransition(reduced: boolean): Transition {
  return { duration: reduced ? 0 : 0.16, ease: EASE_STANDARD }
}
