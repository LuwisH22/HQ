import { beforeEach, describe, expect, it } from 'vitest'
import { clearDemoCache, db, resetDemoDatabase } from './demo-database'
import {
  demoChannelService,
  demoMessageService,
  demoOrganizationService,
  signInAsDemoAdmin,
} from './index'

/**
 * Phase 2 · C3 — threads.
 *
 * A reply is a message, so most of what governs it was already proved by the
 * C1 and C2 suites. What is new is shape — one level, same place, a living
 * root — and the counters that describe it. Everything of the form "somebody
 * who cannot see the channel gets nothing" lives here rather than in the live
 * checks, because those run as the owner, who short-circuits every check.
 */

beforeEach(async () => {
  localStorage.clear()
  clearDemoCache()
  resetDemoDatabase()
  await signInAsDemoAdmin()
})

async function actAsNonOwner(roleName = 'Player') {
  const members = await demoOrganizationService.listMembers('any')
  const target = members.find((m) => !m.roles.some((r) => r.rank === 0))
  if (!target) throw new Error('no non-owner member in the seed')

  const roles = await demoOrganizationService.listRoles('any')
  const role = roles.find((r) => r.name === roleName)
  if (!role) throw new Error(`no role named ${roleName}`)
  await demoOrganizationService.updateMemberRole(target.id, role.id)

  db().currentUserId = target.userId
  return (
    (await demoOrganizationService.listMembers('any')).find((m) => m.id === target.id) ?? target
  )
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
const otherPublicChannel = (not: string) => db().channels.find((c) => !c.isPrivate && c.id !== not)!

describe('replying', () => {
  it('keeps replies out of the channel timeline', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'Scrim besok jam 8.')
    await demoMessageService.send(channel.id, 'Against RRQ?', root.id)

    const page = await demoMessageService.list(channel.id)
    expect(page.messages.map((m) => m.body)).toContain('Scrim besok jam 8.')
    // A reply belongs to its thread, not to the timeline.
    expect(page.messages.map((m) => m.body)).not.toContain('Against RRQ?')
  })

  it('lists a thread oldest first', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'Scrim besok jam 8.')
    await demoMessageService.send(channel.id, 'Against RRQ?', root.id)
    await demoMessageService.send(channel.id, 'Iya.', root.id)

    const replies = await demoMessageService.listReplies(root.id)
    expect(replies.map((m) => m.body)).toEqual(['Against RRQ?', 'Iya.'])
  })

  it('counts replies and records when the last one arrived', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'Scrim besok jam 8.')
    expect(root.replyCount).toBe(0)
    expect(root.lastReplyAt).toBeNull()

    await demoMessageService.send(channel.id, 'Against RRQ?', root.id)
    await demoMessageService.send(channel.id, 'Iya.', root.id)

    const after = await demoMessageService.getById(root.id)
    expect(after?.replyCount).toBe(2)
    expect(after?.lastReplyAt).not.toBeNull()
  })

  it('refuses a reply to a reply', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    const reply = await demoMessageService.send(channel.id, 'first', root.id)

    await expect(demoMessageService.send(channel.id, 'nested', reply.id)).rejects.toThrow(
      /cannot itself be replied to/i,
    )
  })

  it('refuses a reply in a different channel from its root', async () => {
    const channel = publicChannel()
    const elsewhere = otherPublicChannel(channel.id)
    const root = await demoMessageService.send(channel.id, 'root')

    await expect(demoMessageService.send(elsewhere.id, 'wrong channel', root.id)).rejects.toThrow(
      // A reply may now be in a conversation too, so the rule is stated as a
      // place rather than as a channel.
      /same place/i,
    )
  })

  it('refuses a reply to a message that does not exist', async () => {
    const channel = publicChannel()
    await expect(
      demoMessageService.send(channel.id, 'into the void', crypto.randomUUID()),
    ).rejects.toThrow(/no longer exists/i)
  })

  it('inherits messages.send — a deny silences replies too', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    const target = await actAsNonOwner()

    await asOwner(() =>
      demoChannelService.setOverride(channel.id, target.role.id, 'messages.send', 'deny'),
    )

    await expect(demoMessageService.send(channel.id, 'muted', root.id)).rejects.toThrow(
      /cannot post/i,
    )
  })

  it('refuses a reply from a suspended member', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    const target = await actAsNonOwner()
    await asOwner(() => demoOrganizationService.suspendMember(target.id, 'Testing', 7))

    await expect(demoMessageService.send(channel.id, 'still here?', root.id)).rejects.toThrow(
      /cannot post/i,
    )
  })

  it('refuses a reply from a banned member', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    const target = await actAsNonOwner()
    await asOwner(() => demoOrganizationService.banMember(target.id, 'Testing'))

    await expect(demoMessageService.send(channel.id, 'still here?', root.id)).rejects.toThrow(
      /cannot post/i,
    )
  })
})

describe('private channel isolation', () => {
  it('hides a thread in a channel the member cannot see', async () => {
    const secret = privateChannel()
    const root = await asOwner(async () => {
      const message = await demoMessageService.send(secret.id, 'classified')
      await demoMessageService.send(secret.id, 'classified reply', message.id)
      return message
    })

    await actAsNonOwner()
    await expect(demoMessageService.listReplies(root.id)).rejects.toThrow(/access/i)
  })

  it('never returns a reply from an invisible channel in search', async () => {
    const secret = privateChannel()
    await asOwner(async () => {
      const root = await demoMessageService.send(secret.id, 'classified')
      await demoMessageService.send(secret.id, 'classified needle', root.id)
    })

    await actAsNonOwner()
    const results = await demoMessageService.search({ query: 'needle', channelId: null })
    expect(results).toHaveLength(0)
  })
})

describe('deletion', () => {
  it('keeps the thread when the root is deleted', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    await demoMessageService.send(channel.id, 'reply survives', root.id)

    await demoMessageService.remove(root.id)

    // Soft delete: the row survives so the replies keep their context.
    const after = await demoMessageService.getById(root.id)
    expect(after).not.toBeNull()
    expect(after?.deletedAt).not.toBeNull()
    expect(after?.body).toBe('')

    const replies = await demoMessageService.listReplies(root.id)
    expect(replies.map((m) => m.body)).toEqual(['reply survives'])
  })

  it('refuses a new reply once the root is deleted', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    await demoMessageService.remove(root.id)

    await expect(demoMessageService.send(channel.id, 'too late', root.id)).rejects.toThrow(
      /deleted/i,
    )
  })

  it('stops counting a deleted reply', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    const first = await demoMessageService.send(channel.id, 'one', root.id)
    await demoMessageService.send(channel.id, 'two', root.id)
    expect((await demoMessageService.getById(root.id))?.replyCount).toBe(2)

    await demoMessageService.remove(first.id)

    expect((await demoMessageService.getById(root.id))?.replyCount).toBe(1)
    // The row itself survives, as a placeholder in the thread.
    expect((await demoMessageService.listReplies(root.id)).length).toBe(2)
  })

  it('lets a moderator remove somebody else’s reply', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    const reply = await demoMessageService.send(channel.id, 'off topic', root.id)

    await actAsNonOwner('Manager')
    await demoMessageService.remove(reply.id, 'off topic')

    expect((await demoMessageService.getById(reply.id))?.deletedAt).not.toBeNull()
  })
})

describe('replies are ordinary messages', () => {
  it('can be reacted to', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    const reply = await demoMessageService.send(channel.id, 'good call', root.id)

    await demoMessageService.addReaction(reply.id, '👍')
    const byMessage = await demoMessageService.listReactions([reply.id])
    expect(byMessage.get(reply.id)).toEqual([{ emoji: '👍', count: 1, mine: true }])
  })

  it('can be found by search, and the result says it is a reply', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    await demoMessageService.send(channel.id, 'the needle is here', root.id)

    const results = await demoMessageService.search({ query: 'needle', channelId: null })
    expect(results).toHaveLength(1)
    expect(results[0]?.parentMessageId).toBe(root.id)
  })

  it('can be pinned, and unpins itself when deleted', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    const reply = await demoMessageService.send(channel.id, 'worth keeping', root.id)

    await demoMessageService.setPinned(reply.id, true)
    expect((await demoMessageService.listPinned(channel.id)).map((m) => m.id)).toContain(reply.id)

    await demoMessageService.remove(reply.id)
    expect((await demoMessageService.listPinned(channel.id)).map((m) => m.id)).not.toContain(
      reply.id,
    )
  })

  it('is editable by its author and nobody else', async () => {
    const channel = publicChannel()
    const root = await demoMessageService.send(channel.id, 'root')
    const reply = await demoMessageService.send(channel.id, 'typpo', root.id)

    await demoMessageService.edit(reply.id, 'typo, fixed')
    expect((await demoMessageService.getById(reply.id))?.body).toBe('typo, fixed')

    await actAsNonOwner('Manager')
    await expect(demoMessageService.edit(reply.id, 'words put in their mouth')).rejects.toThrow(
      /only edit your own/i,
    )
  })
})
