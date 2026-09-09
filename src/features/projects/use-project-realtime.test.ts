import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'

/**
 * The integration, not Supabase.
 *
 * What is worth testing here is the part this repository wrote: that one
 * subscription is opened per project and taken down again, that a reconnection
 * catches up, and above all that a change arriving while a card is still on its
 * way to the server is remembered rather than acted on. Whether Postgres
 * Changes delivers at all, and what it puts in a payload, is a question for
 * `scripts/verify-projects-realtime.mjs`, which asks the real server.
 */

interface Binding {
  event: string
  schema: string
  table: string
  filter?: string
}

class FakeChannel {
  readonly bindings: { config: Binding; handler: (payload: unknown) => void }[] = []
  subscriber: ((status: string) => void) | null = null
  /** The server's own announcement that replication is running. */
  system: ((payload: unknown) => void) | null = null

  constructor(public readonly topic: string) {}

  on(kind: string, config: Binding, handler: (payload: unknown) => void): this {
    if (kind === 'system') {
      this.system = handler
      return this
    }
    expect(kind).toBe('postgres_changes')
    this.bindings.push({ config, handler })
    return this
  }

  subscribe(callback: (status: string) => void): this {
    this.subscriber = callback
    return this
  }

  /** Deliver one payload to whichever binding asked for that table. */
  deliver(table: string, payload: { new?: unknown; old?: unknown }): void {
    for (const binding of this.bindings) {
      if (binding.config.table === table) binding.handler({ new: {}, old: {}, ...payload })
    }
  }

  get tables(): string[] {
    return this.bindings.map((binding) => binding.config.table)
  }
}

const channels: FakeChannel[] = []
const removed: FakeChannel[] = []
const demo = vi.fn<() => boolean>()

const supabase = {
  channel: (topic: string) => {
    const created = new FakeChannel(topic)
    channels.push(created)
    return created
  },
  getChannels: () => channels.filter((channel) => !removed.includes(channel)),
  removeChannel: (channel: FakeChannel) => {
    removed.push(channel)
    return Promise.resolve('ok')
  },
}

vi.mock('@/lib/supabase', () => ({ getSupabase: () => supabase }))
vi.mock('@/lib/demo-mode', () => ({ isDemoSessionActive: () => demo() }))

const ORG = '3eddb674-7045-42aa-b9c5-7df5b9742486'
const PROJECT = '11111111-1111-4111-8111-111111111111'
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222'
const TASK = '33333333-3333-4333-8333-333333333333'

const board = queryKeys.projects.tasks(ORG, PROJECT)

let client: QueryClient
let invalidated: unknown[][]

beforeEach(() => {
  channels.length = 0
  removed.length = 0
  invalidated = []
  demo.mockReturnValue(false)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(client, 'invalidateQueries').mockImplementation((filters?: { queryKey?: unknown }) => {
    invalidated.push(filters?.queryKey as unknown[])
    return Promise.resolve()
  })
})

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children)
}

/** The channel the hook opened. Failing loudly beats a chain of question marks. */
function open(index = 0): FakeChannel {
  const channel = channels[index]
  if (!channel) throw new Error(`no channel was opened at ${String(index)}`)
  return channel
}

const held = (key: readonly unknown[]) =>
  invalidated.some((seen) => JSON.stringify(seen) === JSON.stringify(key))

/**
 * The page, near enough: the subscription, and a board write that can be held
 * open for as long as a test needs it to be.
 */
function mountProject(projectId: string | undefined = PROJECT) {
  let release: (() => void) | null = null

  const view = renderHook(
    ({ id }: { id: string | undefined }) => {
      const { useProjectRealtime } = realtime
      useProjectRealtime(ORG, id)
      return useMutation({
        mutationKey: queryKeys.projects.tasks(ORG, id ?? 'none'),
        mutationFn: () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      })
    },
    { wrapper, initialProps: { id: projectId } },
  )

  return {
    ...view,
    /** Start a board write and leave it in flight. */
    async beginWrite() {
      act(() => {
        view.result.current.mutate()
      })
      await waitFor(() => {
        expect(view.result.current.isPending).toBe(true)
      })
    },
    /** Let it finish. */
    async finishWrite() {
      await act(async () => {
        release?.()
        await Promise.resolve()
      })
      await waitFor(() => {
        expect(view.result.current.isPending).toBe(false)
      })
    },
  }
}

// Imported once, eagerly: the module reads `getSupabase` at effect time, and
// the mocks above are already in place.
const realtime = await import('./use-project-realtime')

describe('opening the subscription', () => {
  it('opens one topic for the project', () => {
    mountProject()

    expect(channels).toHaveLength(1)
    expect(open().topic).toBe(`project:${PROJECT}`)
  })

  it('listens to the six tables a project is made of, and nothing else', () => {
    mountProject()

    expect(open().tables).toEqual([
      'projects',
      'project_members',
      'tasks',
      'project_labels',
      'task_labels',
      'task_comments',
      'project_review_comments',
    ])
  })

  it('sets no server-side filter, because a deletion carries only an id', () => {
    mountProject()

    for (const binding of open().bindings) {
      expect(binding.config.filter).toBeUndefined()
      expect(binding.config.event).toBe('*')
    }
  })

  it('opens nothing before a project or an organization is known', () => {
    // Called directly rather than through the harness: passing `undefined` to
    // a parameter with a default is not the same as having none.
    renderHook(() => {
      realtime.useProjectRealtime(ORG, undefined)
    }, { wrapper })
    renderHook(() => {
      realtime.useProjectRealtime(undefined, PROJECT)
    }, { wrapper })

    expect(channels).toHaveLength(0)
  })

  it('opens nothing for somebody who may not view projects', () => {
    renderHook(() => {
      realtime.useProjectRealtime(ORG, PROJECT, false)
    }, { wrapper })

    expect(channels).toHaveLength(0)
  })

  it('opens nothing in demo mode, which has no server', () => {
    demo.mockReturnValue(true)
    mountProject()

    expect(channels).toHaveLength(0)
  })

  it('opens the list topic separately, and it hears only about two tables', () => {
    renderHook(() => {
      realtime.useProjectsRealtime(ORG)
    }, { wrapper })

    expect(open().topic).toBe(`projects:${ORG}`)
    expect(open().tables).toEqual(['projects', 'project_members', 'tasks'])
  })
})

describe('what arrives', () => {
  it('refreshes the board when somebody else moves a card', () => {
    mountProject()
    invalidated.length = 0

    open().deliver('tasks', { new: { id: 't1', project_id: PROJECT } })

    expect(held(board)).toBe(true)
  })

  it('leaves this board alone for a task on another project', () => {
    mountProject()
    invalidated.length = 0

    open().deliver('tasks', { new: { id: 't1', project_id: OTHER_PROJECT } })

    expect(invalidated).toEqual([])
  })

  it('refreshes one task conversation without touching the board', () => {
    mountProject()
    invalidated.length = 0

    open().deliver('task_comments', { new: { id: 'c1', task_id: TASK } })

    expect(invalidated).toEqual([queryKeys.projects.comments(ORG, TASK)])
  })
})

describe('a card still on its way to the server', () => {
  it('does not answer a board refresh with the arrangement from before the move', async () => {
    const view = mountProject()
    await view.beginWrite()
    invalidated.length = 0

    // Somebody else's move, arriving while this client's own is in flight.
    open().deliver('tasks', { new: { id: 't1', project_id: PROJECT } })

    // Refetching now would return the board as it was before either move and
    // the card under the pointer would jump back.
    expect(held(board)).toBe(false)
  })

  it('runs the refresh it held back the moment the write settles', async () => {
    const view = mountProject()
    await view.beginWrite()
    open().deliver('tasks', { new: { id: 't1', project_id: PROJECT } })
    invalidated.length = 0

    await view.finishWrite()

    expect(held(board)).toBe(true)
  })

  it('holds one refresh, not one per event', async () => {
    const view = mountProject()
    await view.beginWrite()
    open().deliver('tasks', { new: { id: 't1', project_id: PROJECT } })
    open().deliver('tasks', { new: { id: 't2', project_id: PROJECT } })
    open().deliver('task_labels', { new: { task_id: TASK, label_id: 'l1' } })
    invalidated.length = 0

    await view.finishWrite()

    expect(invalidated.filter((key) => JSON.stringify(key) === JSON.stringify(board))).toHaveLength(
      1,
    )
  })

  it('holds nothing back when nothing arrived', async () => {
    const view = mountProject()
    await view.beginWrite()
    invalidated.length = 0

    await view.finishWrite()

    expect(held(board)).toBe(false)
  })

  it('still refreshes everything that is not the board', async () => {
    const view = mountProject()
    await view.beginWrite()
    invalidated.length = 0

    open().deliver('task_comments', { new: { id: 'c1', task_id: TASK } })
    open().deliver('project_labels', { new: { id: 'l1', project_id: PROJECT } })

    // A conversation and a label catalogue cannot be holding an unconfirmed
    // card, so there is nothing to protect them from.
    expect(held(queryKeys.projects.comments(ORG, TASK))).toBe(true)
    expect(held(queryKeys.projects.labels(ORG, PROJECT))).toBe(true)
  })
})

describe('the connection itself', () => {
  it('refetches everything on connect, which is how a reconnect catches up', () => {
    mountProject()
    invalidated.length = 0

    open().subscriber?.('SUBSCRIBED')

    expect(held(board)).toBe(true)
    expect(held(queryKeys.projects.detail(ORG, PROJECT))).toBe(true)
    expect(held(queryKeys.projects.members(ORG, PROJECT))).toBe(true)
    expect(held(queryKeys.projects.labels(ORG, PROJECT))).toBe(true)
    expect(held(queryKeys.projects.commentsAll(ORG))).toBe(true)
    expect(held(queryKeys.projects.review(ORG, PROJECT))).toBe(true)
  })

  it('catches up again when replication is actually running', () => {
    // The join being acknowledged comes first; the stream behind it is wired
    // up afterwards, and anything written in between reaches nobody on this
    // channel. The server says when it is ready, and that is the honest moment
    // to ask what was missed.
    mountProject()
    invalidated.length = 0

    open().system?.({ extension: 'postgres_changes', status: 'ok', message: 'Subscribed' })

    expect(held(board)).toBe(true)
    expect(held(queryKeys.projects.commentsAll(ORG))).toBe(true)
    expect(held(queryKeys.projects.review(ORG, PROJECT))).toBe(true)
  })

  it('ignores a system message about anything else', () => {
    mountProject()
    invalidated.length = 0

    open().system?.({ extension: 'broadcast', status: 'ok' })

    expect(invalidated).toEqual([])
  })

  it('catches up again after every reconnection, not only the first', () => {
    mountProject()
    invalidated.length = 0

    open().subscriber?.('SUBSCRIBED')
    open().subscriber?.('CLOSED')
    open().subscriber?.('SUBSCRIBED')

    expect(
      invalidated.filter((key) => JSON.stringify(key) === JSON.stringify(board)),
    ).toHaveLength(2)
  })

  it('holds even the catch-up back while a card is in flight', async () => {
    const view = mountProject()
    await view.beginWrite()
    invalidated.length = 0

    open().subscriber?.('SUBSCRIBED')
    expect(held(board)).toBe(false)

    await view.finishWrite()
    expect(held(board)).toBe(true)
  })

  it('says nothing and breaks nothing when the channel errors', () => {
    mountProject()
    invalidated.length = 0

    expect(() => {
      open().subscriber?.('CHANNEL_ERROR')
      open().subscriber?.('TIMED_OUT')
      open().subscriber?.('CLOSED')
    }).not.toThrow()
    // The queries remain the source of truth; a wobble is not news.
    expect(invalidated).toEqual([])
  })
})

describe('the lifetime of the subscription', () => {
  it('takes the channel down when the project goes away', () => {
    const view = mountProject()

    view.unmount()

    expect(removed).toEqual([channels[0]])
  })

  it('survives a rerender without opening a second one', () => {
    const view = mountProject()

    view.rerender({ id: PROJECT })
    view.rerender({ id: PROJECT })

    expect(channels).toHaveLength(1)
    expect(removed).toHaveLength(0)
  })

  it('does not resubscribe while a board write is in flight', async () => {
    // The board rerenders constantly during a drag, and `useIsMutating`
    // rerenders it again at both ends of the write. A subscription that were
    // rebuilt on any of that would drop events in the gap.
    const view = mountProject()

    await view.beginWrite()
    await view.finishWrite()

    expect(channels).toHaveLength(1)
    expect(removed).toHaveLength(0)
  })

  it('clears a channel left over on the same topic before opening its own', () => {
    // What a development-mode double mount leaves behind: `removeChannel` is
    // asynchronous, so the second run can find the first still registered.
    const stale = new FakeChannel(`project:${PROJECT}`)
    channels.push(stale)

    mountProject()

    expect(removed).toContain(stale)
    expect(channels.filter((channel) => !removed.includes(channel))).toHaveLength(1)
  })

  it('follows the reader to another project', () => {
    const view = mountProject()

    view.rerender({ id: OTHER_PROJECT })

    expect(removed).toEqual([channels[0]])
    expect(open(1).topic).toBe(`project:${OTHER_PROJECT}`)
  })
})
