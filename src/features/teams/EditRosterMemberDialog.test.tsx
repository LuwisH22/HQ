import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TeamMember } from '@/services/team.service'
import { EditRosterMemberDialog } from './EditRosterMemberDialog'
import type { useTeamMutations } from './use-teams'

/**
 * A draft, while the database changes underneath it.
 *
 * Realtime makes this immediately relevant: somebody else adding a member
 * refetches the roster, which hands this dialog a new object for the very
 * person it is open over. If that re-filled the fields, a manager half way
 * through typing "Controller" would watch it vanish — which is the same class
 * of bug 7.2 found, arriving from a different direction.
 *
 * The rule is: fill the fields when the dialog opens over somebody, and leave
 * them alone until it opens over somebody else.
 */

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  const id = overrides.memberId ?? 'membership-1'
  return {
    memberId: id,
    userId: `user-${id}`,
    position: null,
    status: 'active',
    addedAt: '2026-02-01T00:00:00.000Z',
    profile: {
      id: `user-${id}`,
      email: 'adit@lfg.gg',
      fullName: 'Adit',
      displayName: null,
      avatarUrl: null,
      title: null,
      timezone: 'Asia/Jakarta',
      lastSeenAt: null,
    },
    ...overrides,
  }
}

/** Just enough of the mutation surface for the dialog to render and submit. */
function stubMutations() {
  const updateMember = {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }
  return { updateMember } as unknown as ReturnType<typeof useTeamMutations>
}

function show(subject: TeamMember | null, mutations = stubMutations()) {
  const view = render(
    <EditRosterMemberDialog
      member={subject}
      teamName="Valorant Main"
      onOpenChange={() => undefined}
      mutations={mutations}
    />,
  )
  return {
    ...view,
    rerenderWith: (next: TeamMember | null) =>
      view.rerender(
        <EditRosterMemberDialog
          member={next}
          teamName="Valorant Main"
          onOpenChange={() => undefined}
          mutations={mutations}
        />,
      ),
  }
}

const position = () => screen.getByLabelText<HTMLInputElement>('Position')

describe('opening over somebody', () => {
  it('fills the fields from their roster row', () => {
    show(member({ position: 'Duelist' }))
    expect(position().value).toBe('Duelist')
  })

  it('leaves the field empty when nobody has typed a position', () => {
    show(member())
    expect(position().value).toBe('')
  })
})

describe('while somebody is typing', () => {
  it('does not lose the draft when the roster is refetched', async () => {
    // Exactly what a realtime refresh produces: the same person, a new object,
    // possibly with a value somebody else just wrote.
    const user = userEvent.setup()
    const view = show(member({ position: 'Duelist' }))

    await user.clear(position())
    await user.type(position(), 'Controller')
    expect(position().value).toBe('Controller')

    view.rerenderWith(member({ position: 'Sentinel' }))

    expect(position().value).toBe('Controller')
  })

  it('does not lose the draft when an unrelated field arrives changed', async () => {
    const user = userEvent.setup()
    const view = show(member({ position: 'Duelist' }))

    await user.type(position(), ' II')
    view.rerenderWith(member({ position: 'Duelist', status: 'substitute' }))

    expect(position().value).toBe('Duelist II')
  })
})

describe('opening over somebody else', () => {
  it('fills the fields again for a different person', () => {
    const view = show(member({ memberId: 'membership-1', position: 'Duelist' }))
    expect(position().value).toBe('Duelist')

    view.rerenderWith(member({ memberId: 'membership-2', position: 'Coach' }))

    // A different row, so the draft belonged to the previous one.
    expect(position().value).toBe('Coach')
  })
})

describe('what it will send', () => {
  it('has nothing to save until something changes', () => {
    show(member({ position: 'Duelist' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('sends the position and the status, and nothing else', async () => {
    const user = userEvent.setup()
    const mutations = stubMutations()
    show(member({ position: 'Duelist' }), mutations)

    await user.clear(position())
    await user.type(position(), 'IGL')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const call = (mutations.updateMember.mutate as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { memberId: string; patch: Record<string, unknown> }
    expect(call.memberId).toBe('membership-1')
    expect(Object.keys(call.patch).sort()).toEqual(['position', 'status'])
    expect(call.patch.position).toBe('IGL')
  })

  it('says a cleared position is being taken off, rather than left alone', async () => {
    const user = userEvent.setup()
    const mutations = stubMutations()
    show(member({ position: 'Duelist' }), mutations)

    await user.clear(position())
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const call = (mutations.updateMember.mutate as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { patch: { position: string | null } }
    expect(call.patch.position).toBeNull()
  })
})
