import { describe, expect, it } from 'vitest'
import {
  initialWorkspaceState,
  normaliseView,
  paramsFromState,
  stateFromParams,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from './calendar-workspace-state'

/**
 * The workspace's state machine.
 *
 * What matters is the shape of every move between the grid and the panel:
 * that a day is always selected, that going deeper and coming back are
 * mirrors, that unsaved typing stops any of it until somebody decides, and
 * that the URL carries exactly the four things worth sharing.
 */

const TODAY = '2026-03-05'

function run(actions: WorkspaceAction[], from: WorkspaceState = initialWorkspaceState(TODAY)) {
  return actions.reduce(workspaceReducer, from)
}

describe('selecting a day', () => {
  it('starts on today, with the panel on the day', () => {
    const state = initialWorkspaceState(TODAY)
    expect(state.selected).toBe(TODAY)
    expect(state.panel).toEqual({ mode: 'day' })
  })

  it('moves the selection and the focus, and does not animate the panel', () => {
    const state = run([{ type: 'SELECT_DAY', day: '2026-03-11' }])
    expect(state.selected).toBe('2026-03-11')
    expect(state.focused).toBe('2026-03-11')
    expect(state.transition).toBe('none')
  })

  it('turns the month over when the day is in another one', () => {
    const state = run([{ type: 'SELECT_DAY', day: '2026-04-02' }])
    expect(state.anchor).toBe('2026-04-02')
  })

  it('keeps the anchor when the day is in the month on screen', () => {
    const state = run([{ type: 'SELECT_DAY', day: '2026-03-28' }])
    expect(state.anchor).toBe(TODAY)
  })
})

describe('opening an event', () => {
  it('goes deeper, selects its day and remembers where it came from', () => {
    const state = run([{ type: 'OPEN_EVENT', eventId: 'ev-1', day: '2026-03-11', from: 'grid' }])
    expect(state.panel).toEqual({ mode: 'event', eventId: 'ev-1' })
    expect(state.selected).toBe('2026-03-11')
    expect(state.transition).toBe('deeper')
    expect(state.origin).toEqual({ from: 'grid', eventId: 'ev-1' })
    expect(state.sheet).toBe('full')
  })

  it('comes back to the day, the mirror way, and lands the sheet at half', () => {
    const state = run([
      { type: 'OPEN_EVENT', eventId: 'ev-1', day: '2026-03-11', from: 'panel' },
      { type: 'BACK' },
    ])
    expect(state.panel).toEqual({ mode: 'day' })
    expect(state.selected).toBe('2026-03-11')
    expect(state.transition).toBe('back')
    expect(state.sheet).toBe('half')
  })

  it('edits deeper still, and Back from editing returns to the event', () => {
    const opened = run([{ type: 'OPEN_EVENT', eventId: 'ev-1', day: TODAY, from: 'grid' }])
    const editing = workspaceReducer(opened, { type: 'START_EDIT' })
    expect(editing.panel).toEqual({ mode: 'edit', eventId: 'ev-1' })
    expect(editing.transition).toBe('deeper')

    const back = workspaceReducer(editing, { type: 'BACK' })
    expect(back.panel).toEqual({ mode: 'event', eventId: 'ev-1' })
    expect(back.transition).toBe('back')
  })

  it('drops to the day when somebody else removes the open event', () => {
    const opened = run([{ type: 'OPEN_EVENT', eventId: 'ev-1', day: TODAY, from: 'grid' }])
    expect(workspaceReducer(opened, { type: 'EVENT_GONE', eventId: 'ev-2' })).toBe(opened)
    expect(workspaceReducer(opened, { type: 'EVENT_GONE', eventId: 'ev-1' }).panel).toEqual({
      mode: 'day',
    })
  })

  it('confirms deletion inline, as a sub-state of the event', () => {
    const opened = run([{ type: 'OPEN_EVENT', eventId: 'ev-1', day: TODAY, from: 'grid' }])
    const asking = workspaceReducer(opened, { type: 'CONFIRM_DELETE', open: true })
    expect(asking.panel).toEqual({ mode: 'event', eventId: 'ev-1' })
    expect(asking.confirmingDelete).toBe(true)
    expect(workspaceReducer(asking, { type: 'DELETED' }).panel).toEqual({ mode: 'day' })
  })
})

describe('creating', () => {
  it('rises from the day rather than arriving from the side', () => {
    const state = run([{ type: 'START_CREATE' }])
    expect(state.panel).toEqual({ mode: 'create', seed: { day: TODAY } })
    expect(state.transition).toBe('lateral')
  })

  it('takes the seed it is given and selects that day', () => {
    const state = run([
      { type: 'START_CREATE', seed: { day: '2026-03-20', startTime: '19:00', endTime: '21:00' } },
    ])
    expect(state.selected).toBe('2026-03-20')
    expect(state.panel).toEqual({
      mode: 'create',
      seed: { day: '2026-03-20', startTime: '19:00', endTime: '21:00' },
    })
  })

  it('opens what was created, deeper, once it is saved', () => {
    const state = run([{ type: 'START_CREATE' }, { type: 'SAVED', eventId: 'ev-9', day: TODAY }])
    expect(state.panel).toEqual({ mode: 'event', eventId: 'ev-9' })
    expect(state.transition).toBe('deeper')
  })
})

describe('the dirty guard', () => {
  const editing = run([
    { type: 'OPEN_EVENT', eventId: 'ev-1', day: TODAY, from: 'grid' },
    { type: 'START_EDIT' },
    { type: 'SET_DIRTY', dirty: true },
  ])

  it('holds a day selection until somebody decides', () => {
    const held = workspaceReducer(editing, { type: 'SELECT_DAY', day: '2026-03-11' })
    expect(held.panel).toEqual({ mode: 'edit', eventId: 'ev-1' })
    expect(held.selected).toBe(TODAY)
    expect(held.pending).toEqual({ kind: 'select-day', day: '2026-03-11' })
  })

  it('keeps editing on Keep', () => {
    const held = workspaceReducer(editing, { type: 'SELECT_DAY', day: '2026-03-11' })
    const kept = workspaceReducer(held, { type: 'GUARD_KEEP' })
    expect(kept.pending).toBeNull()
    expect(kept.dirty).toBe(true)
    expect(kept.panel).toEqual({ mode: 'edit', eventId: 'ev-1' })
  })

  it('replays the held move on Discard', () => {
    const held = workspaceReducer(editing, { type: 'SELECT_DAY', day: '2026-03-11' })
    const discarded = workspaceReducer(held, { type: 'GUARD_DISCARD' })
    expect(discarded.dirty).toBe(false)
    expect(discarded.pending).toBeNull()
    expect(discarded.panel).toEqual({ mode: 'day' })
    expect(discarded.selected).toBe('2026-03-11')
  })

  it('holds Cancel the same way, and Discard then returns to the event', () => {
    const held = workspaceReducer(editing, { type: 'CANCEL_FORM' })
    expect(held.pending).toEqual({ kind: 'back' })
    expect(workspaceReducer(held, { type: 'GUARD_DISCARD' }).panel).toEqual({
      mode: 'event',
      eventId: 'ev-1',
    })
  })

  it('holds a month turn, and replays it after leaving the form', () => {
    const held = workspaceReducer(editing, { type: 'NAVIGATE', direction: 1 })
    expect(held.anchor).toBe(TODAY)
    const discarded = workspaceReducer(held, { type: 'GUARD_DISCARD' })
    expect(discarded.anchor).toBe('2026-04-05')
    expect(discarded.panel).toEqual({ mode: 'event', eventId: 'ev-1' })
  })

  it('does not guard a clean form', () => {
    const clean = workspaceReducer(editing, { type: 'SET_DIRTY', dirty: false })
    expect(workspaceReducer(clean, { type: 'CANCEL_FORM' }).panel).toEqual({
      mode: 'event',
      eventId: 'ev-1',
    })
  })
})

describe('turning the month', () => {
  it('moves the window and the selection together, clamped', () => {
    const state = run([
      { type: 'SELECT_DAY', day: '2026-01-31' },
      { type: 'NAVIGATE', direction: 1 },
    ])
    expect(state.anchor).toBe('2026-02-28')
    expect(state.selected).toBe('2026-02-28')
    expect(state.gridDirection).toBe(1)
  })

  it('keeps an open event open while the month turns', () => {
    const state = run([
      { type: 'OPEN_EVENT', eventId: 'ev-1', day: TODAY, from: 'grid' },
      { type: 'NAVIGATE', direction: -1 },
    ])
    expect(state.panel).toEqual({ mode: 'event', eventId: 'ev-1' })
    expect(state.anchor).toBe('2026-02-05')
  })

  it('jumps to today without a direction', () => {
    const state = run([
      { type: 'NAVIGATE', direction: 1 },
      { type: 'TODAY', today: TODAY },
    ])
    expect(state.anchor).toBe(TODAY)
    expect(state.selected).toBe(TODAY)
    expect(state.gridDirection).toBe(0)
  })

  it('steps a week in week view', () => {
    const state = run([
      { type: 'SET_VIEW', view: 'week' },
      { type: 'NAVIGATE', direction: 1 },
    ])
    expect(state.view).toBe('week')
    expect(state.selected).toBe('2026-03-12')
  })
})

describe('the URL', () => {
  it('reads the four parameters, and fills the rest from today', () => {
    const state = stateFromParams(
      { view: 'week', date: '2026-03-11', event: 'ev-1', mode: 'edit' },
      TODAY,
      true,
    )
    expect(state.view).toBe('week')
    expect(state.selected).toBe('2026-03-11')
    expect(state.anchor).toBe('2026-03-11')
    expect(state.panel).toEqual({ mode: 'edit', eventId: 'ev-1' })
    expect(state.sheet).toBe('full')
  })

  it('ignores a date that is not one', () => {
    expect(stateFromParams({ date: 'yesterday' }, TODAY, true).selected).toBe(TODAY)
  })

  it('opens a new form from mode=new', () => {
    expect(stateFromParams({ mode: 'new', date: '2026-03-11' }, TODAY, true).panel).toEqual({
      mode: 'create',
      seed: { day: '2026-03-11' },
    })
  })

  it('writes only what is not the default', () => {
    expect(paramsFromState(initialWorkspaceState(TODAY))).toEqual({
      view: null,
      date: TODAY,
      event: null,
      mode: null,
    })
    const editing = run([
      { type: 'OPEN_EVENT', eventId: 'ev-1', day: TODAY, from: 'grid' },
      { type: 'START_EDIT' },
    ])
    expect(paramsFromState(editing)).toEqual({
      view: null,
      date: TODAY,
      event: 'ev-1',
      mode: 'edit',
    })
    expect(paramsFromState(run([{ type: 'START_CREATE' }])).mode).toBe('new')
  })

  it('has no day view on a desktop and no week view on a phone', () => {
    expect(normaliseView('day', true)).toBe('month')
    expect(normaliseView('week', true)).toBe('week')
    expect(normaliseView('week', false)).toBe('day')
    expect(normaliseView('day', false)).toBe('day')
    expect(normaliseView(null, false)).toBe('month')
  })
})
