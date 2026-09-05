import { beforeEach, describe, expect, it } from 'vitest'
import { clearDemoCache, db, resetDemoDatabase } from './demo-database'
import {
  demoChannelService,
  demoMessageService,
  demoNotificationService,
  demoOrganizationService,
  signInAsDemoAdmin,
} from './index'

/**
 * Phase 2 · C2 — reactions, read state, pins, notifications and search.
 *
 * These carry the weight for the same reason the B3 and C1 suites do: the
 * live verification runs as the organization owner, who short-circuits every
 * check by design. Everything of the form "somebody who cannot see X gets
 * nothing" is proved here, against a faithful port of the same resolver the
 * database uses.
 */

beforeEach(async () => {
  localStorage.clear()
  clearDemoCache()
  resetDemoDatabase()
  await signInAsDemoAdmin()
})

/** Act as somebody who is not the owner, holding exactly one known role. */
async function actAsNonOwner(roleName = 'Player') {
  const members = await demoOrganizationService.listMembers('any')
  const target = members.find((m) => !m.roles.some((r) => r.rank === 0))
  if (!target) throw new Error('no non-owner member in the seed')

  const roles = await demoOrganizationService.listRoles('any')
  const role = roles.find((r) => r.name === roleName)
  if (!role) throw new Error(`no role named ${roleName}`)
  await demoOrganizationService.updateMemberRole(target.id, role.id)

  db().currentUserId = target.userId
  const refreshed = (await demoOrganizationService.listMembers('any')).find(
    (m) => m.id === target.id,
  )
  return refreshed ?? target
}

async function asOwner<T>(work: () => Promise<T>): Promise<T> {
  const previous = db().currentUserId
  db().currentUserId = null
  await signInAsDemoAdmin()
  const result = await work()
  db().currentUserId = previous
  return result
}

const publicChannel = () => {
  const withHistory = db().messages[0]?.channelId
  return (
    db().channels.find((c) => !c.isPrivate && c.id === withHistory) ??
    db().channels.find((c) => !c.isPrivate)!
  )
}
const privateChannel = () => db().channels.find((c) => c.isPrivate)!

describe('reactions', () => {
  it('adds one and counts it as yours', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'worth a thumbs up')
    await demoMessageService.addReaction(sent.id, '👍')

    const byMessage = await demoMessageService.listReactions([sent.id])
    expect(byMessage.get(sent.id)).toEqual([{ emoji: '👍', count: 1, mine: true }])
  })

  it('is one row per person per emoji, however many times it is sent', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'double tap')
    await demoMessageService.addReaction(sent.id, '👍')
    await demoMessageService.addReaction(sent.id, '👍')

    expect(db().reactions.filter((r) => r.messageId === sent.id)).toHaveLength(1)
  })

  it('counts other people separately and does not claim them as yours', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'popular')
    await demoMessageService.addReaction(sent.id, '🔥')

    const target = await actAsNonOwner()
    await demoMessageService.addReaction(sent.id, '🔥')

    const asThem = await demoMessageService.listReactions([sent.id])
    expect(asThem.get(sent.id)).toEqual([{ emoji: '🔥', count: 2, mine: true }])
    expect(target).toBeTruthy()
  })

  it('removes only your own', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'mixed feelings')
    await demoMessageService.addReaction(sent.id, '👍')
    const target = await actAsNonOwner()
    await demoMessageService.addReaction(sent.id, '👍')

    await demoMessageService.removeReaction(sent.id, '👍')

    const left = db().reactions.filter((r) => r.messageId === sent.id)
    expect(left).toHaveLength(1)
    expect(left[0]?.userId).not.toBe(target.userId)
  })

  it('refuses to react where a deny silences you', async () => {
    const channel = publicChannel()
    const sent = await demoMessageService.send(channel.id, 'you may read this')
    const target = await actAsNonOwner()

    await asOwner(() =>
      demoChannelService.setOverride(channel.id, target.role.id, 'messages.send', 'deny'),
    )

    // Reacting is speaking. A deny that silenced messages but not reactions
    // would leave a signalling channel wide open.
    await expect(demoMessageService.addReaction(sent.id, '👍')).rejects.toThrow(/cannot react/i)
  })

  it('refuses to react in a channel the member cannot see', async () => {
    const secret = privateChannel()
    const sent = await asOwner(() => demoMessageService.send(secret.id, 'private business'))
    await actAsNonOwner()

    await expect(demoMessageService.addReaction(sent.id, '👍')).rejects.toThrow(/cannot react/i)
  })

  it('hides reactions on messages the member cannot read', async () => {
    const secret = privateChannel()
    const sent = await asOwner(async () => {
      const message = await demoMessageService.send(secret.id, 'private business')
      await demoMessageService.addReaction(message.id, '👍')
      return message
    })

    await actAsNonOwner()
    const byMessage = await demoMessageService.listReactions([sent.id])
    expect(byMessage.get(sent.id)).toBeUndefined()
  })

  it('refuses to react to a deleted message, and drops the ones already there', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'about to go')
    await demoMessageService.addReaction(sent.id, '👍')

    await demoMessageService.remove(sent.id)

    expect(db().reactions.filter((r) => r.messageId === sent.id)).toHaveLength(0)
    await expect(demoMessageService.addReaction(sent.id, '👍')).rejects.toThrow(/deleted/i)
  })

  it('refuses to react while suspended', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'still here')
    const target = await actAsNonOwner()
    await asOwner(() => demoOrganizationService.suspendMember(target.id, 'Testing', 7))

    await expect(demoMessageService.addReaction(sent.id, '👍')).rejects.toThrow(/cannot react/i)
  })
})

describe('read state', () => {
  it('counts what arrived after you last looked', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    await demoChannelService.markRead(channel.id)

    await asOwner(() => demoMessageService.send(channel.id, 'something new'))

    db().currentUserId = target.userId
    const counts = await demoChannelService.unreadCounts()
    expect(counts.find((c) => c.channelId === channel.id)?.unread).toBe(1)
  })

  it('does not count your own messages', async () => {
    const channel = publicChannel()
    await demoChannelService.markRead(channel.id)
    await demoMessageService.send(channel.id, 'talking to myself')

    const counts = await demoChannelService.unreadCounts()
    expect(counts.find((c) => c.channelId === channel.id)?.unread).toBe(0)
  })

  it('does not count deleted messages', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    await demoChannelService.markRead(channel.id)

    const sent = await asOwner(() => demoMessageService.send(channel.id, 'never mind'))
    await asOwner(() => demoMessageService.remove(sent.id))

    db().currentUserId = target.userId
    const counts = await demoChannelService.unreadCounts()
    expect(counts.find((c) => c.channelId === channel.id)?.unread).toBe(0)
  })

  it('clears when the channel is opened', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    await asOwner(() => demoMessageService.send(channel.id, 'unread for now'))

    db().currentUserId = target.userId
    expect(
      (await demoChannelService.unreadCounts()).find((c) => c.channelId === channel.id)?.unread,
    ).toBeGreaterThan(0)

    await demoChannelService.markRead(channel.id)
    expect(
      (await demoChannelService.unreadCounts()).find((c) => c.channelId === channel.id)?.unread,
    ).toBe(0)
  })

  it('never moves the marker backwards', async () => {
    const channel = publicChannel()
    await demoChannelService.markRead(channel.id)

    const stored = db().channelReads.find((r) => r.channelId === channel.id)!
    const future = new Date(Date.now() + 60_000).toISOString()
    stored.lastReadAt = future

    // A stale second device catching up must not undo the newer read.
    await demoChannelService.markRead(channel.id)
    expect(stored.lastReadAt).toBe(future)
  })

  it('reports nothing at all for a channel the member cannot see', async () => {
    const secret = privateChannel()
    await actAsNonOwner()

    const counts = await demoChannelService.unreadCounts()
    // Absent, not zero: a zero would confirm the channel exists.
    expect(counts.some((c) => c.channelId === secret.id)).toBe(false)
  })

  it('refuses to record a read in a channel the member cannot see', async () => {
    const secret = privateChannel()
    await actAsNonOwner()

    await expect(demoChannelService.markRead(secret.id)).rejects.toThrow(/access/i)
  })
})

describe('pinned messages', () => {
  it('lists pins newest first', async () => {
    const channel = publicChannel()
    const first = await demoMessageService.send(channel.id, 'pin me first')
    const second = await demoMessageService.send(channel.id, 'pin me second')

    await demoMessageService.setPinned(first.id, true)
    await demoMessageService.setPinned(second.id, true)

    const pinned = await demoMessageService.listPinned(channel.id)
    expect(pinned.map((m) => m.body)).toEqual(['pin me second', 'pin me first'])
  })

  it('unpins a message that gets deleted', async () => {
    const channel = publicChannel()
    const sent = await demoMessageService.send(channel.id, 'pinned then removed')
    await demoMessageService.setPinned(sent.id, true)

    await demoMessageService.remove(sent.id)

    // A pin pointing at words nobody can read is worse than no pin.
    expect(await demoMessageService.listPinned(channel.id)).toHaveLength(0)
  })

  it('refuses to list pins in a channel the member cannot see', async () => {
    const secret = privateChannel()
    await actAsNonOwner()

    await expect(demoMessageService.listPinned(secret.id)).rejects.toThrow(/access/i)
  })

  it('refuses to pin without messages.pin', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'not yours to pin')
    await actAsNonOwner('Player')

    await expect(demoMessageService.setPinned(sent.id, true)).rejects.toThrow(/permission/i)
  })
})

describe('search', () => {
  it('finds a message by a word in it', async () => {
    const channel = publicChannel()
    await demoMessageService.send(channel.id, 'scrim against Ascend on Tuesday')

    const results = await demoMessageService.search({ query: 'Ascend', channelId: null })
    expect(results.map((r) => r.body)).toContain('scrim against Ascend on Tuesday')
  })

  it('narrows to one channel when asked', async () => {
    const channel = publicChannel()
    const other = db().channels.find((c) => !c.isPrivate && c.id !== channel.id)!
    await demoMessageService.send(channel.id, 'needle here')
    await demoMessageService.send(other.id, 'needle there')

    const results = await demoMessageService.search({ query: 'needle', channelId: channel.id })
    expect(results).toHaveLength(1)
    expect(results[0]?.channelId).toBe(channel.id)
  })

  it('never returns a message from a channel the member cannot see', async () => {
    const secret = privateChannel()
    await asOwner(() => demoMessageService.send(secret.id, 'classified needle'))
    await actAsNonOwner()

    const results = await demoMessageService.search({ query: 'needle', channelId: null })
    expect(results).toHaveLength(0)
  })

  it('never returns a deleted message', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'temporary needle')
    await demoMessageService.remove(sent.id)

    const results = await demoMessageService.search({ query: 'needle', channelId: null })
    expect(results).toHaveLength(0)
  })

  it('returns nothing for an empty query rather than everything', async () => {
    expect(await demoMessageService.search({ query: '   ', channelId: null })).toHaveLength(0)
  })

  it('returns nothing to a suspended member', async () => {
    await demoMessageService.send(publicChannel().id, 'visible needle')
    const target = await actAsNonOwner()
    await asOwner(() => demoOrganizationService.suspendMember(target.id, 'Testing', 7))

    db().currentUserId = target.userId
    expect(await demoMessageService.search({ query: 'needle', channelId: null })).toHaveLength(0)
  })
})

describe('mention notifications', () => {
  /** The seeded display name of the non-owner used across these tests. */
  function handleOf(userId: string): string {
    const profile = db().profiles.find((p) => p.id === userId)
    return profile?.displayName ?? profile!.email.split('@')[0]!
  }

  it('notifies somebody named in a channel they can see', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    await asOwner(() => demoMessageService.send(channel.id, `@${handle} can you scrim tonight?`))

    db().currentUserId = target.userId
    const notifications = await demoNotificationService.list('any')
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.type).toBe('mention')
    expect(notifications[0]?.summary).toContain(channel.name)
  })

  it('does NOT notify somebody named in a channel they cannot see', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    await asOwner(() => demoMessageService.send(secret.id, `@${handle} classified`))

    db().currentUserId = target.userId
    // The whole point: a notification here would leak the channel's name and
    // the existence of a message in it.
    expect(await demoNotificationService.list('any')).toHaveLength(0)
  })

  it('does not notify you about your own mention', async () => {
    const channel = publicChannel()
    const me = db().profiles.find((p) => p.id === db().currentUserId)!
    const handle = me.displayName ?? me.email.split('@')[0]!

    await demoMessageService.send(channel.id, `@${handle} talking to myself`)

    expect(await demoNotificationService.list('any')).toHaveLength(0)
  })

  it('shows a notification only to its recipient', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)
    await asOwner(() => demoMessageService.send(channel.id, `@${handle} heads up`))

    // The owner wrote it; it is not addressed to them.
    const asOwnerList = await asOwner(() => demoNotificationService.list('any'))
    expect(asOwnerList).toHaveLength(0)

    db().currentUserId = target.userId
    expect(await demoNotificationService.list('any')).toHaveLength(1)
  })

  it('marks read and stops counting', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)
    await asOwner(() => demoMessageService.send(channel.id, `@${handle} one`))

    db().currentUserId = target.userId
    expect(await demoNotificationService.unreadCount('any')).toBe(1)

    await demoNotificationService.markRead()
    expect(await demoNotificationService.unreadCount('any')).toBe(0)
  })
})

describe('channel member visibility', () => {
  it('lists every active member for a public channel, and no others', async () => {
    const ids = await demoChannelService.listChannelMembers(publicChannel().id)

    // Not simply every member: the seed carries a suspended one, and the
    // moderation gate is the first thing the resolver checks.
    const active = db().members.filter((m) => m.status === 'active')
    expect(ids.length).toBe(active.length)
    expect(ids.length).toBeLessThan(db().members.length)
  })

  it('lists only the allowed roles for a private channel', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()

    const before = await asOwner(() => demoChannelService.listChannelMembers(secret.id))
    expect(before).not.toContain(target.userId)

    await asOwner(() =>
      demoChannelService.setOverride(secret.id, target.role.id, 'channels.view', 'allow'),
    )

    const after = await asOwner(() => demoChannelService.listChannelMembers(secret.id))
    expect(after).toContain(target.userId)
  })

  it('tells a member who cannot see the channel nothing at all', async () => {
    const secret = privateChannel()
    await actAsNonOwner()

    // Empty rather than an error: a guessed id must look like an empty channel.
    expect(await demoChannelService.listChannelMembers(secret.id)).toEqual([])
  })

  it('drops a suspended member from the list', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    await asOwner(() => demoOrganizationService.suspendMember(target.id, 'Testing', 7))

    const ids = await asOwner(() => demoChannelService.listChannelMembers(channel.id))
    expect(ids).not.toContain(target.userId)
  })
})
