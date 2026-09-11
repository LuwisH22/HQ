import { useEffect, useReducer, useRef, type Dispatch } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { DayKey } from './calendar-time'
import {
  normaliseView,
  paramsFromState,
  stateFromParams,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from './calendar-workspace-state'

/**
 * The workspace reducer, with the URL as its persisted subset.
 *
 * `view`, `date`, `event` and `mode` are read once on mount and written back
 * with `replace` whenever they change, so a reload lands where the person was
 * and a link to an event opens it in the panel with its day selected — without
 * every arrow key leaving a history entry behind.
 *
 * If the URL changes for any reason other than this hook writing it — a link
 * followed while the page is open — the state is rebuilt from it.
 */
export function useCalendarWorkspace(
  today: DayKey,
  desktop: boolean,
): [WorkspaceState, Dispatch<WorkspaceAction>] {
  const [searchParams, setSearchParams] = useSearchParams()

  const [state, dispatch] = useReducer(workspaceReducer, undefined, () =>
    stateFromParams(read(searchParams), today, desktop),
  )

  const written = paramsFromState(state)
  const signature = serialise(written)
  const incoming = serialise(read(searchParams))

  // Two URL strings this state already accounts for: the one it was built
  // from on mount, and the last one it wrote. Anything else arrived from
  // outside — a link followed while the page was open — and rebuilds the
  // state. The mount string is forgotten once the hook has written, so
  // returning to that exact URL later counts as arriving from outside.
  const builtFrom = useRef<string | null>(incoming)
  const lastWritten = useRef<string | null>(null)

  // State → URL.
  useEffect(() => {
    if (signature === incoming || signature === lastWritten.current) return
    lastWritten.current = signature
    builtFrom.current = null
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const [key, value] of Object.entries(written)) {
          if (value === null) next.delete(key)
          else next.set(key, value)
        }
        return next
      },
      { replace: true },
    )
    // `written` is the four values `signature` already encodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, incoming, setSearchParams])

  // URL → state, only for a change this hook did not make itself.
  useEffect(() => {
    if (incoming === signature || incoming === lastWritten.current) return
    if (incoming === builtFrom.current) return
    builtFrom.current = incoming
    lastWritten.current = null
    dispatch({ type: 'HYDRATE', state: stateFromParams(read(searchParams), today, desktop) })
    // Only a genuinely new URL should rebuild the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming])

  // A desktop has no day view and a phone has no week view; crossing the
  // breakpoint with the other one showing lands on its nearest equivalent.
  useEffect(() => {
    const view = normaliseView(state.view, desktop)
    if (view !== state.view) dispatch({ type: 'SET_VIEW', view })
  }, [desktop, state.view])

  return [state, dispatch]
}

function read(params: URLSearchParams) {
  return {
    view: params.get('view'),
    date: params.get('date'),
    event: params.get('event'),
    mode: params.get('mode'),
  }
}

function serialise(params: {
  view: string | null
  date: string | null
  event: string | null
  mode: string | null
}): string {
  return [params.view ?? '', params.date ?? '', params.event ?? '', params.mode ?? ''].join('|')
}
