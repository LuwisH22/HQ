import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'

/**
 * The subscription, not Supabase.
 *
 * What is worth testing is the part this repository wrote: one topic per team,
 * torn down and rebuilt when the reader navigates, nothing opened for somebody
 * who may not view teams, and a reconnection that catches up rather than
 * assuming it missed nothing. Whether Postgres Changes delivers at all, and
 * what it puts in a payload, is a question for
 * `scripts/verify-teams-realtime.mjs`, which asks the real server.
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
const TEAM = '11111111-1111-4111-8111-111111111111'
const OTHER_TEAM = '22222222-2222-4222-8222-222222222222'

const { useTeamRealtime, useTeamsRealtime } = await import('./use-team-realtime')

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

function open(index = 0): FakeChannel {
  const channel = channels[index]
  if (!channel) throw new Error(`no channel was opened at ${String(index)}`)
  return channel
}

const held = (key: readonly unknown[]) =>
  invalidated.some((seen) => JSON.stringify(seen) === JSON.stringify(key))

function mountTeam(teamId: string | undefined = TEAM, enabled = true) {
  return renderHook(
    ({ id }: { id: string | undefined }) => {
      useTeamRealtime(ORG, id, enabled)
    },
    { wrapper, initialProps: { id: teamId } },
  )
}

describe('opening the subscription', () => {
  it('opens one topic for the team', () => {
    mountTeam()

    expect(channels).toHaveLength(1)
    expect(open().topic).toBe(`team:${TEAM}`)
  })

  it('listens to the two tables a team is made of, and nothing else', () => {
    mountTeam()
    expect(open().tables).toEqual(['teams', 'team_members'])
  })

  it('sets no server-side filter, because a deletion carries only a key', () => {
    mountTeam()
    for (const binding of open().bindings) {
      expect(binding.config.filter).toBeUndefined()
      expect(binding.config.event).toBe('*')
    }
  })

  it('opens nothing before a team or an organization is known', () => {
    renderHook(() => {
      useTeamRealtime(ORG, undefined)
    }, { wrapper })
    renderHook(() => {
      useTeamRealtime(undefined, TEAM)
    }, { wrapper })

    expect(channels).toHaveLength(0)
  })

  it('opens nothing for somebody who may not view teams', () => {
    // The permission carries into `enabled`, so losing teams.view closes the
    // socket rather than merely hiding what it feeds.
    mountTeam(TEAM, false)
    expect(channels).toHaveLength(0)
  })

  it('opens nothing in demo mode, which has no server', () => {
    demo.mockReturnValue(true)
    mountTeam()
    expect(channels).toHaveLength(0)
  })

  it('opens the list topic separately, over the same two tables', () => {
    renderHook(() => {
      useTeamsRealtime(ORG)
    }, { wrapper })

    expect(open().topic).toBe(`teams:${ORG}`)
    expect(open().tables).toEqual(['teams', 'team_members'])
  })
})

describe('what arrives', () => {
  it('refreshes the roster and the team when somebody joins', () => {
    mountTeam()
    invalidated.length = 0

    open().deliver('team_members', { new: { team_id: TEAM, member_id: 'membership-1' } })

    expect(held(queryKeys.teams.members(ORG, TEAM))).toBe(true)
    expect(held(queryKeys.teams.detail(ORG, TEAM))).toBe(true)
    expect(held(queryKeys.teams.rosters(ORG))).toBe(true)
  })

  it('refreshes the same families when somebody leaves', () => {
    mountTeam()
    invalidated.length = 0

    open().deliver('team_members', { new: {}, old: { team_id: TEAM, member_id: 'membership-1' } })

    expect(held(queryKeys.teams.members(ORG, TEAM))).toBe(true)
    expect(held(queryKeys.teams.list(ORG))).toBe(true)
  })

  it('leaves this team alone for a roster change on another', () => {
    mountTeam()
    invalidated.length = 0

    open().deliver('team_members', { new: { team_id: OTHER_TEAM, member_id: 'membership-1' } })

    expect(invalidated).toEqual([])
  })

  it('refreshes the header when the team is renamed or archived', () => {
    mountTeam()
    invalidated.length = 0

    open().deliver('teams', { new: { id: TEAM, organization_id: ORG, name: 'Renamed' } })

    expect(held(queryKeys.teams.detail(ORG, TEAM))).toBe(true)
    expect(held(queryKeys.teams.list(ORG))).toBe(true)
  })
})

describe('the connection itself', () => {
  it('refetches everything on connect, which is how a reconnect catches up', () => {
    mountTeam()
    invalidated.length = 0

    open().subscriber?.('SUBSCRIBED')

    expect(held(queryKeys.teams.detail(ORG, TEAM))).toBe(true)
    expect(held(queryKeys.teams.members(ORG, TEAM))).toBe(true)
    expect(held(queryKeys.teams.rosters(ORG))).toBe(true)
    expect(held(queryKeys.teams.list(ORG))).toBe(true)
  })

  it('catches up again when replication is actually running', () => {
    // The join being acknowledged comes first; the stream behind it is wired
    // up afterwards, and anything written in between reaches nobody.
    mountTeam()
    invalidated.length = 0

    open().system?.({ extension: 'postgres_changes', status: 'ok' })

    expect(held(queryKeys.teams.members(ORG, TEAM))).toBe(true)
  })

  it('ignores a system message about anything else', () => {
    mountTeam()
    invalidated.length = 0

    open().system?.({ extension: 'broadcast', status: 'ok' })

    expect(invalidated).toEqual([])
  })

  it('catches up after every reconnection, not only the first', () => {
    mountTeam()
    invalidated.length = 0

    open().subscriber?.('SUBSCRIBED')
    open().subscriber?.('CLOSED')
    open().subscriber?.('SUBSCRIBED')

    const detail = invalidated.filter(
      (key) => JSON.stringify(key) === JSON.stringify(queryKeys.teams.detail(ORG, TEAM)),
    )
    expect(detail).toHaveLength(2)
  })

  it('says nothing and breaks nothing when the channel errors', () => {
    mountTeam()
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
  it('takes the channel down when the team goes away', () => {
    const view = mountTeam()
    view.unmount()

    expect(removed).toEqual([channels[0]])
  })

  it('survives a rerender without opening a second one', () => {
    const view = mountTeam()

    view.rerender({ id: TEAM })
    view.rerender({ id: TEAM })

    expect(channels).toHaveLength(1)
    expect(removed).toHaveLength(0)
  })

  it('follows the reader to another team, leaving nothing behind', () => {
    const view = mountTeam()

    view.rerender({ id: OTHER_TEAM })

    expect(removed).toEqual([channels[0]])
    expect(open(1).topic).toBe(`team:${OTHER_TEAM}`)
    // Exactly one live subscription after navigating.
    expect(channels.filter((channel) => !removed.includes(channel))).toHaveLength(1)
  })

  it('clears a channel left over on the same topic before opening its own', () => {
    // What a development-mode double mount leaves behind: `removeChannel` is
    // asynchronous, so the second run can find the first still registered.
    const stale = new FakeChannel(`team:${TEAM}`)
    channels.push(stale)

    mountTeam()

    expect(removed).toContain(stale)
    expect(channels.filter((channel) => !removed.includes(channel))).toHaveLength(1)
  })
})
