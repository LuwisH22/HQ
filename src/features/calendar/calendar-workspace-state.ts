import { addDays, addMonths, monthOf, type DayKey } from './calendar-time'

/**
 * Where the calendar workspace is, and how it got there.
 *
 * Two things are on screen: a grid and a panel beside it. The grid knows a
 * window (`anchor`), one selected day and one focused day; the panel knows
 * which of its four modes it is in. They are linked by the selected day and by
 * nothing else — a month can turn over with an event still open, and a day
 * can be picked with the panel showing a form, which is exactly the case the
 * dirty guard below exists for.
 *
 * Everything here is a plain reducer over plain values so it can be tested
 * without a component, and so the URL can carry the part of it worth sharing.
 * See `docs/design/CALENDAR-UX-MOTION-AUDIT.md` §B and §H.
 */

/** Month and week on a desktop; month and day on a phone. */
export type View = 'month' | 'week' | 'day'

/** Which side of the screen an event was opened from, for returning focus. */
export type Origin = 'grid' | 'panel'

/** What a fresh form is filled in with. */
export interface DraftSeed {
  day: DayKey
  startTime?: string
  endTime?: string
}

export type PanelState =
  | { mode: 'day' }
  | { mode: 'event'; eventId: string }
  | { mode: 'edit'; eventId: string }
  | { mode: 'create'; seed: DraftSeed }

/**
 * How the panel body should arrive.
 *
 *   deeper   day → event → edit: the new body slides in from the right
 *   back     the reverse: from the left
 *   lateral  day → create: a new thing on the same day, so it rises instead
 *   none     the same mode redrawn, which animates nothing
 */
export type PanelTransition = 'deeper' | 'back' | 'lateral' | 'none'

/** Which way the grid slid last, so the incoming month knows where to enter from. */
export type GridDirection = -1 | 0 | 1

/** An action the dirty guard is holding until the person decides. */
export type Pending =
  | { kind: 'select-day'; day: DayKey }
  | { kind: 'open-event'; eventId: string; day: DayKey; from: Origin }
  | { kind: 'back' }
  | { kind: 'create'; seed: DraftSeed }
  | { kind: 'navigate'; direction: -1 | 1 }
  | { kind: 'today'; today: DayKey }
  | { kind: 'set-view'; view: View }

export type SheetSnap = 'peek' | 'half' | 'full'

export interface WorkspaceState {
  view: View
  /** The month or week on screen. In day view, the day. */
  anchor: DayKey
  /** Exactly one, always. The panel describes it. */
  selected: DayKey
  /** Keyboard roving focus in the grid; follows `selected` unless arrowed away. */
  focused: DayKey
  panel: PanelState
  /** The form in the panel has unsaved input. Only meaningful in edit/create. */
  dirty: boolean
  pending: Pending | null
  /** The inline delete confirmation is showing. A sub-state of `event`. */
  confirmingDelete: boolean
  /** Where the open event was opened from, so Back can return focus there. */
  origin: { from: Origin; eventId: string } | null
  transition: PanelTransition
  gridDirection: GridDirection
  /** The mobile sheet's snap point. Ignored on a desktop. */
  sheet: SheetSnap
}

export type WorkspaceAction =
  | { type: 'SELECT_DAY'; day: DayKey }
  | { type: 'FOCUS_DAY'; day: DayKey }
  | { type: 'OPEN_EVENT'; eventId: string; day: DayKey; from: Origin }
  | { type: 'BACK' }
  | { type: 'START_EDIT' }
  | { type: 'START_CREATE'; seed?: Partial<DraftSeed> }
  | { type: 'SET_DIRTY'; dirty: boolean }
  | { type: 'SAVED'; eventId: string; day: DayKey }
  | { type: 'CANCEL_FORM' }
  | { type: 'CONFIRM_DELETE'; open: boolean }
  | { type: 'DELETED' }
  | { type: 'EVENT_GONE'; eventId: string }
  | { type: 'GUARD_KEEP' }
  | { type: 'GUARD_DISCARD' }
  | { type: 'NAVIGATE'; direction: -1 | 1 }
  | { type: 'TODAY'; today: DayKey }
  | { type: 'SET_VIEW'; view: View }
  | { type: 'SET_SHEET'; snap: SheetSnap }
  /** The URL changed under the page — a link followed while it was open. */
  | { type: 'HYDRATE'; state: WorkspaceState }

export function initialWorkspaceState(today: DayKey): WorkspaceState {
  return {
    view: 'month',
    anchor: today,
    selected: today,
    focused: today,
    panel: { mode: 'day' },
    dirty: false,
    pending: null,
    confirmingDelete: false,
    origin: null,
    transition: 'none',
    gridDirection: 0,
    sheet: 'peek',
  }
}

/** Whether leaving the panel's current body would lose typing. */
export function isFormDirty(state: WorkspaceState): boolean {
  return (state.panel.mode === 'edit' || state.panel.mode === 'create') && state.dirty
}

/** The event the panel is about, in any mode that has one. */
export function panelEventId(panel: PanelState): string | null {
  return panel.mode === 'event' || panel.mode === 'edit' ? panel.eventId : null
}

function leaveForm(state: WorkspaceState): WorkspaceState {
  return { ...state, dirty: false, pending: null, confirmingDelete: false }
}

/** Which way the panel moves when it goes from one mode to another. */
function transitionBetween(from: PanelState['mode'], to: PanelState['mode']): PanelTransition {
  if (from === to) return 'none'
  if (from === 'day' && to === 'create') return 'lateral'
  const depth: Record<PanelState['mode'], number> = { day: 0, create: 1, event: 1, edit: 2 }
  return depth[to] > depth[from] ? 'deeper' : 'back'
}

function showDay(state: WorkspaceState, day: DayKey, focus = true): WorkspaceState {
  const changedMode = state.panel.mode !== 'day'
  return {
    ...leaveForm(state),
    selected: day,
    focused: focus ? day : state.focused,
    panel: { mode: 'day' },
    origin: null,
    transition: changedMode ? 'back' : 'none',
    gridDirection: 0,
    // On a phone, leaving a deeper mode lands on the rundown, not the peek.
    sheet: changedMode && state.sheet === 'full' ? 'half' : state.sheet,
  }
}

function showEvent(
  state: WorkspaceState,
  eventId: string,
  day: DayKey,
  origin: WorkspaceState['origin'],
  transition: PanelTransition,
): WorkspaceState {
  return {
    ...leaveForm(state),
    selected: day,
    focused: day,
    panel: { mode: 'event', eventId },
    origin,
    transition,
    gridDirection: 0,
    sheet: 'full',
  }
}

/** The window that contains a day, for the view being shown. */
function anchorFor(view: View, day: DayKey, current: DayKey): DayKey {
  if (view === 'month') return monthOf(day) === monthOf(current) ? current : day
  return day
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'SELECT_DAY': {
      if (isFormDirty(state)) return { ...state, pending: { kind: 'select-day', day: action.day } }
      return {
        ...showDay(state, action.day),
        anchor: anchorFor(state.view, action.day, state.anchor),
      }
    }

    case 'FOCUS_DAY':
      return {
        ...state,
        focused: action.day,
        anchor: anchorFor(state.view, action.day, state.anchor),
        gridDirection: 0,
      }

    case 'OPEN_EVENT': {
      if (isFormDirty(state)) {
        return {
          ...state,
          pending: {
            kind: 'open-event',
            eventId: action.eventId,
            day: action.day,
            from: action.from,
          },
        }
      }
      const same = panelEventId(state.panel) === action.eventId
      return {
        ...showEvent(
          state,
          action.eventId,
          action.day,
          { from: action.from, eventId: action.eventId },
          same && state.panel.mode === 'event'
            ? 'none'
            : transitionBetween(state.panel.mode, 'event'),
        ),
        anchor: anchorFor(state.view, action.day, state.anchor),
      }
    }

    case 'BACK': {
      if (state.panel.mode === 'day') return state
      if (isFormDirty(state)) return { ...state, pending: { kind: 'back' } }
      // Editing returns to the event; everything else returns to the day.
      if (state.panel.mode === 'edit') {
        return showEvent(state, state.panel.eventId, state.selected, state.origin, 'back')
      }
      return showDay(state, state.selected)
    }

    case 'START_EDIT': {
      if (state.panel.mode !== 'event') return state
      return {
        ...leaveForm(state),
        panel: { mode: 'edit', eventId: state.panel.eventId },
        transition: 'deeper',
        gridDirection: 0,
        sheet: 'full',
      }
    }

    case 'START_CREATE': {
      const seed: DraftSeed = { ...action.seed, day: action.seed?.day ?? state.selected }
      if (isFormDirty(state)) return { ...state, pending: { kind: 'create', seed } }
      return {
        ...leaveForm(state),
        selected: seed.day,
        focused: seed.day,
        anchor: anchorFor(state.view, seed.day, state.anchor),
        panel: { mode: 'create', seed },
        origin: null,
        transition: transitionBetween(state.panel.mode, 'create'),
        gridDirection: 0,
        sheet: 'full',
      }
    }

    case 'SET_DIRTY':
      return state.dirty === action.dirty ? state : { ...state, dirty: action.dirty }

    case 'SAVED': {
      const created = state.panel.mode === 'create'
      return {
        ...showEvent(
          state,
          action.eventId,
          action.day,
          { from: 'panel', eventId: action.eventId },
          created ? 'deeper' : 'back',
        ),
        anchor: anchorFor(state.view, action.day, state.anchor),
      }
    }

    case 'CANCEL_FORM': {
      if (state.panel.mode !== 'edit' && state.panel.mode !== 'create') return state
      if (isFormDirty(state)) return { ...state, pending: { kind: 'back' } }
      return workspaceReducer({ ...state, dirty: false }, { type: 'BACK' })
    }

    case 'CONFIRM_DELETE':
      if (state.panel.mode !== 'event') return state
      return { ...state, confirmingDelete: action.open }

    case 'DELETED':
      return showDay(state, state.selected)

    case 'EVENT_GONE': {
      // Somebody else removed what the panel is about. Never keep a ghost open.
      if (panelEventId(state.panel) !== action.eventId) return state
      return showDay(state, state.selected)
    }

    case 'GUARD_KEEP':
      return { ...state, pending: null }

    case 'GUARD_DISCARD': {
      const pending = state.pending
      const clean: WorkspaceState = { ...state, dirty: false, pending: null }
      if (!pending) return clean
      switch (pending.kind) {
        case 'select-day':
          return workspaceReducer(clean, { type: 'SELECT_DAY', day: pending.day })
        case 'open-event':
          return workspaceReducer(clean, {
            type: 'OPEN_EVENT',
            eventId: pending.eventId,
            day: pending.day,
            from: pending.from,
          })
        case 'back':
          return workspaceReducer(clean, { type: 'BACK' })
        case 'create': {
          // A fresh form replaces the abandoned one, from wherever it was.
          const base = workspaceReducer(clean, { type: 'BACK' })
          return workspaceReducer(base, { type: 'START_CREATE', seed: pending.seed })
        }
        case 'navigate':
          return workspaceReducer(workspaceReducer(clean, { type: 'BACK' }), {
            type: 'NAVIGATE',
            direction: pending.direction,
          })
        case 'today':
          return workspaceReducer(workspaceReducer(clean, { type: 'BACK' }), {
            type: 'TODAY',
            today: pending.today,
          })
        case 'set-view':
          return workspaceReducer(workspaceReducer(clean, { type: 'BACK' }), {
            type: 'SET_VIEW',
            view: pending.view,
          })
      }
      return clean
    }

    case 'NAVIGATE': {
      if (isFormDirty(state)) {
        return { ...state, pending: { kind: 'navigate', direction: action.direction } }
      }
      const step = state.view === 'month' ? 0 : state.view === 'week' ? 7 : 1
      const anchor =
        state.view === 'month'
          ? addMonths(state.anchor, action.direction)
          : addDays(state.anchor, step * action.direction)
      // The selection follows the window so the panel always has a real day:
      // the same day of the next month, clamped, or the same weekday next week.
      const selected =
        state.view === 'month'
          ? monthOf(state.selected) === monthOf(state.anchor)
            ? addMonths(state.selected, action.direction)
            : monthOf(anchor) === monthOf(state.selected)
              ? state.selected
              : `${monthOf(anchor)}-01`
          : addDays(state.selected, step * action.direction)
      return {
        ...state,
        anchor,
        selected,
        focused: selected,
        gridDirection: action.direction,
        transition: 'none',
        pending: null,
        confirmingDelete: false,
      }
    }

    case 'TODAY': {
      if (isFormDirty(state)) return { ...state, pending: { kind: 'today', today: action.today } }
      const same = state.selected === action.today && state.anchor === action.today
      return {
        ...state,
        anchor: action.today,
        selected: action.today,
        focused: action.today,
        gridDirection: 0,
        transition: same ? state.transition : 'none',
        pending: null,
        confirmingDelete: false,
      }
    }

    case 'SET_VIEW': {
      if (state.view === action.view) return state
      if (isFormDirty(state)) return { ...state, pending: { kind: 'set-view', view: action.view } }
      return {
        ...state,
        view: action.view,
        // A week or a day is anchored on the selected day; a month on itself.
        anchor: action.view === 'month' ? state.selected : state.selected,
        gridDirection: 0,
        transition: 'none',
        pending: null,
      }
    }

    case 'SET_SHEET':
      return state.sheet === action.snap ? state : { ...state, sheet: action.snap }

    case 'HYDRATE':
      return action.state
  }
}

/* ---------------------------------------------------------------------------
   The URL.

   Four things survive a reload or a shared link: the view, the selected day,
   the open event and whether it is being edited or a new one is being written.
   Focus, dirtiness and the draft's contents do not — they are this session's.
--------------------------------------------------------------------------- */

export interface WorkspaceParams {
  view?: string | null
  date?: string | null
  event?: string | null
  mode?: string | null
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** The view a platform can show. A day is a panel on a desktop, a week a scroll on a phone. */
export function normaliseView(view: string | null | undefined, desktop: boolean): View {
  if (view === 'week') return desktop ? 'week' : 'day'
  if (view === 'day') return desktop ? 'month' : 'day'
  return 'month'
}

/** A state from a URL, with today filling in whatever the URL does not say. */
export function stateFromParams(
  params: WorkspaceParams,
  today: DayKey,
  desktop: boolean,
): WorkspaceState {
  const base = initialWorkspaceState(today)
  const day = params.date && DAY_PATTERN.test(params.date) ? params.date : today
  const view = normaliseView(params.view, desktop)

  let panel: PanelState = { mode: 'day' }
  if (params.event) {
    panel =
      params.mode === 'edit'
        ? { mode: 'edit', eventId: params.event }
        : { mode: 'event', eventId: params.event }
  } else if (params.mode === 'new') {
    panel = { mode: 'create', seed: { day } }
  }

  return {
    ...base,
    view,
    anchor: day,
    selected: day,
    focused: day,
    panel,
    sheet: panel.mode === 'day' ? 'peek' : 'full',
  }
}

/** The four parameters a state is worth, as strings. Absent means default. */
export function paramsFromState(
  state: WorkspaceState,
): Record<'view' | 'date' | 'event' | 'mode', string | null> {
  const eventId = panelEventId(state.panel)
  return {
    view: state.view === 'month' ? null : state.view,
    date: state.selected,
    event: eventId,
    mode: state.panel.mode === 'edit' ? 'edit' : state.panel.mode === 'create' ? 'new' : null,
  }
}
