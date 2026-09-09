import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The integration, not Supabase.
 *
 * What is worth testing here is the part this repository wrote: that one
 * subscription is opened per organization and taken down again, that every
 * kind of change asks the calendar to refetch, that a change belonging to
 * somebody else's organization does not, and that a connection wobble is not
 * treated as news. Whether Postgres Changes delivers at all is a question for
 * `scripts/verify-calendar-realtime.mjs`, which asks the real server.
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

  constructor(public readonly topic: string) {}

  on(kind: string, config: Binding, handler: (payload: unknown) => void): this {
    expect(kind).toBe('postgres_changes')
    this.bindings.push({ config, handler })
    return this
  }

  subscribe(callback: (status: string) => void): this {
    this.subscriber = callback
    return this
  }

  /** Deliver one Postgres Changes payload to every binding that would match. */
  deliver(payload: { eventType: string; new?: unknown; old?: unknown }): void {
    for (const binding of this.bindings) {
      if (binding.config.event === '*' || binding.config.event === payload.eventType) {
        binding.handler(payload)
      }
    }
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
const OTHER = '00000000-0000-4000-8000-000000000000'

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

async function mountFor(organizationId: string | undefined) {
  const { useCalendarRealtime } = await import('./use-calendar-realtime')
  return renderHook(
    ({ id }: { id: string | undefined }) => {
      useCalendarRealtime(id)
    },
    { wrapper, initialProps: { id: organizationId } },
  )
}

const mount = () => mountFor(ORG)

/** The channel the hook opened. Failing loudly beats a chain of question marks. */
function open(index = 0): FakeChannel {
  const channel = channels[index]
  if (!channel) throw new Error(`no channel was opened at ${String(index)}`)
  return channel
}

/** Its one subscription's configuration. */
function binding(index = 0) {
  const first = open(index).bindings[0]
  if (!first) throw new Error('the channel subscribed to nothing')
  return first.config
}

/** The event as Supabase sends it: a full row, an id, or an empty envelope. */
const insert = (organizationId = ORG) => ({
  eventType: 'INSERT',
  new: { id: 'e1', organization_id: organizationId, title: 'Scrim vs RRQ' },
  old: {},
})
const update = (organizationId = ORG) => ({
  eventType: 'UPDATE',
  new: { id: 'e1', organization_id: organizationId, title: 'Scrim vs RRQ, moved' },
  old: {},
})
/** A deletion carries the primary key and nothing else — verified live. */
const remove = () => ({ eventType: 'DELETE', new: {}, old: { id: 'e1' } })
/** What a subscriber who may not read the row receives. */
const unauthorized = () => ({ eventType: 'INSERT', new: {}, old: {} })

describe('opening the subscription', () => {
  it('opens one topic for the organization', async () => {
    await mount()

    expect(channels).toHaveLength(1)
    expect(open().topic).toBe(`calendar:${ORG}`)
  })

  it('listens to every change on the calendar table, and to nothing else', async () => {
    await mount()

    expect(open().bindings).toHaveLength(1)
    expect(binding()).toEqual({
      event: '*',
      schema: 'public',
      table: 'calendar_events',
    })
  })

  it('sets no server-side filter, because a deletion carries only an id', async () => {
    await mount()

    expect(binding().filter).toBeUndefined()
  })

  it('opens nothing before an organization is known', async () => {
    await mountFor(undefined)

    expect(channels).toHaveLength(0)
    expect(invalidated).toHaveLength(0)
  })

  it('opens nothing in demo mode, which has no server', async () => {
    demo.mockReturnValue(true)
    await mount()

    expect(channels).toHaveLength(0)
  })
})

describe('what arrives', () => {
  it('asks the calendar again when an event is created', async () => {
    await mount()
    invalidated.length = 0

    open().deliver(insert())

    expect(invalidated).toEqual([['calendar', ORG]])
  })

  it('asks again when one is edited', async () => {
    await mount()
    invalidated.length = 0

    open().deliver(update())

    expect(invalidated).toEqual([['calendar', ORG]])
  })

  it('asks again when one is deleted, which arrives as a bare id', async () => {
    await mount()
    invalidated.length = 0

    open().deliver(remove())

    expect(invalidated).toEqual([['calendar', ORG]])
  })

  it('invalidates the calendar family and nothing wider', async () => {
    await mount()
    invalidated.length = 0

    open().deliver(insert())

    // ['calendar', <org>] prefixes every range key for this organization, and
    // matches no other query in the application.
    for (const key of invalidated) expect(key).toEqual(['calendar', ORG])
  })

  it('ignores another organization entirely', async () => {
    await mount()
    invalidated.length = 0

    open().deliver(insert(OTHER))
    open().deliver(update(OTHER))

    expect(invalidated).toEqual([])
  })

  it('treats an unauthorized envelope as news, since it cannot be attributed', async () => {
    await mount()
    invalidated.length = 0

    // Empty new and old, with an errors entry: what a subscriber who may not
    // read the row receives. The refetch it causes is scoped by RLS.
    open().deliver(unauthorized())

    expect(invalidated).toEqual([['calendar', ORG]])
  })

  it('does not multiply: two identical events cost two refetches, not two rows', async () => {
    await mount()
    invalidated.length = 0

    open().deliver(insert())
    open().deliver(insert())

    expect(invalidated).toEqual([
      ['calendar', ORG],
      ['calendar', ORG],
    ])
  })
})

describe('the connection itself', () => {
  it('refetches on connect, which is also how a reconnect catches up', async () => {
    await mount()
    invalidated.length = 0

    open().subscriber?.('SUBSCRIBED')

    expect(invalidated).toEqual([['calendar', ORG]])
  })

  it('catches up again after every reconnection, not only the first', async () => {
    await mount()
    invalidated.length = 0

    open().subscriber?.('SUBSCRIBED')
    open().subscriber?.('CLOSED')
    open().subscriber?.('SUBSCRIBED')

    expect(invalidated).toHaveLength(2)
  })

  it('says nothing and breaks nothing when the channel errors', async () => {
    await mount()
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
  it('takes the channel down when the calendar goes away', async () => {
    const view = await mount()

    view.unmount()

    expect(removed).toEqual([channels[0]])
  })

  it('survives a rerender without opening a second one', async () => {
    const view = await mount()

    view.rerender({ id: ORG })
    view.rerender({ id: ORG })

    expect(channels).toHaveLength(1)
    expect(removed).toHaveLength(0)
  })

  it('clears a channel left over on the same topic before opening its own', async () => {
    // What a development-mode double mount leaves behind: `removeChannel` is
    // asynchronous, so the second run can find the first still registered.
    const stale = new FakeChannel(`calendar:${ORG}`)
    channels.push(stale)

    await mount()

    expect(removed).toContain(stale)
    expect(channels.filter((channel) => !removed.includes(channel))).toHaveLength(1)
  })

  it('follows the organization when the workspace changes', async () => {
    const view = await mount()

    view.rerender({ id: OTHER })

    expect(removed).toEqual([channels[0]])
    expect(channels).toHaveLength(2)
    expect(open(1).topic).toBe(`calendar:${OTHER}`)
  })

  it('stops listening once there is no organization', async () => {
    const view = await mount()

    view.rerender({ id: undefined })

    expect(removed).toEqual([channels[0]])
    expect(channels).toHaveLength(1)
  })
})
