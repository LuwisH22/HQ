import { beforeEach, describe, expect, it } from 'vitest'
import { clearDemoCache, db, DEMO_OWNER_PROFILE_ID, resetDemoDatabase } from './demo-database'
import {
  demoConversationService,
  demoMessageService,
  demoNotificationService,
  demoOrganizationService,
  signInAsDemoAdmin,
} from './index'

/**
 * Phase 2 · C3 — direct messages.
 *
 * This is where the DM authorization model is proved, because the live checks
 * run as the organization's owner and the whole point of a conversation is
 * that the owner is nobody special inside one. Membership is the entire rule:
 * no role grants it, no override grants it, no permission grants it, and
 * ownership does not grant it either.
 */

beforeEach(async () => {
  localStorage.clear()
  clearDemoCache()
  resetDemoDatabase()
  await signInAsDemoAdmin()
})

const ORG = 'any'

/** Somebody who is not the owner, left signed in as themselves. */
async function actAsNonOwner(roleName = 'Player') {
  const members = await demoOrganizationService.listMembers(ORG)
  const target = members.find((m) => !m.roles.some((r) => r.rank === 0))
  if (!target) throw new Error('no non-owner member in the seed')

  const roles = await demoOrganizationService.listRoles(ORG)
  const role = roles.find((r) => r.name === roleName)
  if (!role) throw new Error(`no role named ${roleName}`)
  await demoOrganizationService.updateMemberRole(target.id, role.id)

  db().currentUserId = target.userId
  return (await demoOrganizationService.listMembers(ORG)).find((m) => m.id === target.id) ?? target
}

async function asOwner<T>(work: () => Promise<T>): Promise<T> {
  const previous = db().currentUserId
  db().currentUserId = null
  await signInAsDemoAdmin()
  const result = await work()
  db().currentUserId = previous
  return result
}

/** The demo organization's owner, who is signed in by default. */
const owner = () => DEMO_OWNER_PROFILE_ID

/** Two members who are not the owner, for the isolation checks. */
function others(count: number): string[] {
  const ids = db()
    .members.map((m) => m.userId)
    .filter((id) => id !== owner())
  if (ids.length < count) throw new Error(`the seed has fewer than ${String(count)} other members`)
  return ids.slice(0, count)
}

async function conversationBetween(a: string, b: string): Promise<string> {
  const previous = db().currentUserId
  db().currentUserId = a
  const id = await demoConversationService.startDirect(ORG, b)
  db().currentUserId = previous
  return id
}

describe('starting one', () => {
  it('creates a conversation with two members in it', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)

    expect(id).toBeTruthy()
    const members = db()
      .conversationMembers.filter((m) => m.conversationId === id)
      .map((m) => m.userId)
      .sort()
    expect(members).toEqual([owner(), other!].sort())
  })

  it('returns the same one however many times it is asked for', async () => {
    const [other] = others(1)
    const first = await demoConversationService.startDirect(ORG, other!)
    const second = await demoConversationService.startDirect(ORG, other!)
    const third = await demoConversationService.startDirect(ORG, other!)

    expect(second).toBe(first)
    expect(third).toBe(first)
    // The uniqueness rule is a property of the pair, not of who asked.
    expect(db().conversations).toHaveLength(1)
  })

  it('is the same conversation whichever way round it is started', async () => {
    const [other] = others(1)
    const mine = await demoConversationService.startDirect(ORG, other!)

    db().currentUserId = other!
    const theirs = await demoConversationService.startDirect(ORG, owner())

    expect(theirs).toBe(mine)
    expect(db().conversations).toHaveLength(1)
  })

  it('refuses a conversation with yourself', async () => {
    await expect(demoConversationService.startDirect(ORG, owner())).rejects.toThrow(/yourself/i)
    expect(db().conversations).toHaveLength(0)
  })

  it('refuses somebody who is not in the organization', async () => {
    await expect(
      demoConversationService.startDirect(ORG, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow(/not available/i)
  })

  it('refuses a suspended member, and says nothing more than that', async () => {
    const target = await actAsNonOwner()
    await asOwner(() => demoOrganizationService.suspendMember(target.id, 'Testing', 7))

    await asOwner(() =>
      expect(demoConversationService.startDirect(ORG, target.userId)).rejects.toThrow(
        /not available/i,
      ),
    )
  })

  it('refuses a banned member', async () => {
    const target = await actAsNonOwner()
    await asOwner(() => demoOrganizationService.banMember(target.id, 'Testing'))

    await asOwner(() =>
      expect(demoConversationService.startDirect(ORG, target.userId)).rejects.toThrow(
        /not available/i,
      ),
    )
  })

  it('refuses a suspended member trying to start one', async () => {
    const target = await actAsNonOwner()
    await asOwner(() => demoOrganizationService.suspendMember(target.id, 'Testing', 7))

    db().currentUserId = target.userId
    await expect(demoConversationService.startDirect(ORG, owner())).rejects.toThrow(/access/i)
  })
})

describe('who can see it', () => {
  it('lists it for the people in it', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)

    expect((await demoConversationService.list(ORG)).map((c) => c.id)).toEqual([id])

    db().currentUserId = other!
    expect((await demoConversationService.list(ORG)).map((c) => c.id)).toEqual([id])
  })

  it('names it after the other person, from each side', async () => {
    const [other] = others(1)
    await demoConversationService.startDirect(ORG, other!)

    const otherProfile = db().profiles.find((p) => p.id === other)!
    const mineProfile = db().profiles.find((p) => p.id === owner())!

    expect((await demoConversationService.list(ORG))[0]?.otherName).toBe(otherProfile.displayName)

    db().currentUserId = other!
    expect((await demoConversationService.list(ORG))[0]?.otherName).toBe(mineProfile.displayName)
  })

  it('does NOT list it for somebody who is not in it', async () => {
    const [a, b] = others(2)
    await conversationBetween(a!, b!)

    // The owner of the organization, who can see every channel by design.
    expect(await demoConversationService.list(ORG)).toEqual([])
    expect(await demoConversationService.getById(db().conversations[0]!.id)).toBeNull()
  })

  it('gives the owner no way in, whatever they hold', async () => {
    const [a, b] = others(2)
    const id = await conversationBetween(a!, b!)

    // Every permission in the catalogue, and it changes nothing: a
    // conversation is not reached through permissions at all.
    await expect(demoMessageService.listConversation(id)).rejects.toThrow(/access/i)
    await expect(demoMessageService.sendToConversation(id, 'let me in')).rejects.toThrow(/access/i)
    await expect(demoConversationService.markRead(id)).rejects.toThrow(/access/i)
    expect(await demoConversationService.listMentionCandidates(id)).toEqual([])
  })

  it('closes the door when a member is suspended', async () => {
    const target = await actAsNonOwner()
    const id = await asOwner(() => demoConversationService.startDirect(ORG, target.userId))

    db().currentUserId = target.userId
    expect((await demoConversationService.list(ORG)).map((c) => c.id)).toEqual([id])

    await asOwner(() => demoOrganizationService.suspendMember(target.id, 'Testing', 7))

    db().currentUserId = target.userId
    expect(await demoConversationService.list(ORG)).toEqual([])
    await expect(demoMessageService.sendToConversation(id, 'still here?')).rejects.toThrow(
      /access/i,
    )
  })

  it('closes it when a member is banned', async () => {
    const target = await actAsNonOwner()
    const id = await asOwner(() => demoConversationService.startDirect(ORG, target.userId))
    await asOwner(() => demoOrganizationService.banMember(target.id, 'Testing'))

    db().currentUserId = target.userId
    expect(await demoConversationService.list(ORG)).toEqual([])
    await expect(demoMessageService.listConversation(id)).rejects.toThrow(/access/i)
  })
})

describe('messages in one', () => {
  it('sends, lists and belongs to exactly one place', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)

    const sent = await demoMessageService.sendToConversation(id, 'halo')
    expect(sent.conversationId).toBe(id)
    expect(sent.channelId).toBeNull()

    const page = await demoMessageService.listConversation(id)
    expect(page.messages.map((m) => m.body)).toEqual(['halo'])
  })

  it('keeps a direct message out of every channel timeline', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    await demoMessageService.sendToConversation(id, 'private words')

    for (const channel of db().channels) {
      const page = await demoMessageService.list(channel.id)
      expect(page.messages.map((m) => m.body)).not.toContain('private words')
    }
  })

  it('does not show one to somebody outside the conversation', async () => {
    const [a, b] = others(2)
    const id = await conversationBetween(a!, b!)
    db().currentUserId = a!
    const sent = await demoMessageService.sendToConversation(id, 'between us')

    // The owner again: absent, not filtered.
    db().currentUserId = null
    await signInAsDemoAdmin()
    await expect(demoMessageService.getById(sent.id)).rejects.toThrow(/access/i)
  })

  it('lets the author edit and refuses everybody else', async () => {
    const target = await actAsNonOwner()
    const id = await asOwner(() => demoConversationService.startDirect(ORG, target.userId))

    const sent = await asOwner(() => demoMessageService.sendToConversation(id, 'first'))

    db().currentUserId = target.userId
    await expect(demoMessageService.edit(sent.id, 'not yours')).rejects.toThrow(/your own/i)

    await asOwner(() => demoMessageService.edit(sent.id, 'corrected'))
    const page = await asOwner(() => demoMessageService.listConversation(id))
    expect(page.messages[0]?.body).toBe('corrected')
  })

  it('does not let moderation reach inside a conversation', async () => {
    // The other member holds messages.moderate at organization level, which
    // is exactly the power that must not follow them into a DM.
    const target = await actAsNonOwner('Admin')
    const id = await asOwner(() => demoConversationService.startDirect(ORG, target.userId))
    const sent = await asOwner(() => demoMessageService.sendToConversation(id, 'mine to keep'))

    db().currentUserId = target.userId
    await expect(demoMessageService.remove(sent.id)).rejects.toThrow(/your own/i)
  })

  it('removes a deleted direct message rather than leaving a tombstone', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    const sent = await demoMessageService.sendToConversation(id, 'never mind')

    await demoMessageService.remove(sent.id)

    // Nothing to be evidence of, and no replies to keep reachable.
    expect(db().messages.some((m) => m.id === sent.id)).toBe(false)
    expect((await demoMessageService.listConversation(id)).messages).toHaveLength(0)
  })

  it('keeps a deleted root that has replies, so the thread survives', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    const root = await demoMessageService.sendToConversation(id, 'opening')
    await demoMessageService.sendToConversation(id, 'reply', root.id)

    await demoMessageService.remove(root.id)

    const still = db().messages.find((m) => m.id === root.id)
    expect(still?.deletedAt).not.toBeNull()
    expect(await demoMessageService.listReplies(root.id)).toHaveLength(1)
  })

  it('writes no audit entry for anything done in a conversation', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    const before = db().auditLogs.length

    const sent = await demoMessageService.sendToConversation(id, 'quiet')
    await demoMessageService.setPinned(sent.id, true)
    await demoMessageService.setPinned(sent.id, false)
    await demoMessageService.remove(sent.id)

    // An entry would tell every holder of the audit permission that the
    // conversation exists and when it was used.
    expect(db().auditLogs).toHaveLength(before)
  })

  it('refuses a reply attached across two conversations', async () => {
    const [a, b] = others(2)
    const first = await demoConversationService.startDirect(ORG, a!)
    const second = await demoConversationService.startDirect(ORG, b!)

    const root = await demoMessageService.sendToConversation(first, 'over here')
    await expect(
      demoMessageService.sendToConversation(second, 'wrong place', root.id),
    ).rejects.toThrow(/same place/i)
  })

  it('refuses a reply attached from a channel to a conversation', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    const root = await demoMessageService.sendToConversation(id, 'in the dm')

    const channel = db().channels.find((c) => !c.isPrivate)!
    await expect(demoMessageService.send(channel.id, 'from a channel', root.id)).rejects.toThrow(
      /same place/i,
    )
  })
})

describe('pins and reactions', () => {
  it('lets either person pin, with no permission involved', async () => {
    const target = await actAsNonOwner()
    const id = await asOwner(() => demoConversationService.startDirect(ORG, target.userId))
    const sent = await asOwner(() => demoMessageService.sendToConversation(id, 'keep this'))

    // A Player holds no messages.pin anywhere, and pins here anyway.
    db().currentUserId = target.userId
    await demoMessageService.setPinned(sent.id, true)

    expect(await demoMessageService.listConversationPinned(id)).toHaveLength(1)
  })

  it('does not expose a pinned direct message through a channel path', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    const sent = await demoMessageService.sendToConversation(id, 'pinned in a dm')
    await demoMessageService.setPinned(sent.id, true)

    for (const channel of db().channels) {
      expect(await demoMessageService.listPinned(channel.id)).toHaveLength(0)
    }
  })

  it('reacts, and stamps the conversation rather than a channel', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    const sent = await demoMessageService.sendToConversation(id, 'nice')

    await demoMessageService.addReaction(sent.id, '👍')

    const row = db().reactions.find((r) => r.messageId === sent.id)
    expect(row?.conversationId).toBe(id)
    expect(row?.channelId).toBeNull()
  })

  it('hides a reaction from somebody outside the conversation', async () => {
    const [a, b] = others(2)
    const id = await conversationBetween(a!, b!)
    db().currentUserId = a!
    const sent = await demoMessageService.sendToConversation(id, 'ours')
    await demoMessageService.addReaction(sent.id, '👍')

    db().currentUserId = null
    await signInAsDemoAdmin()
    expect((await demoMessageService.listReactions([sent.id])).get(sent.id)).toBeUndefined()
  })

  it('refuses a reaction from somebody outside the conversation', async () => {
    const [a, b] = others(2)
    const id = await conversationBetween(a!, b!)
    db().currentUserId = a!
    const sent = await demoMessageService.sendToConversation(id, 'ours')

    db().currentUserId = null
    await signInAsDemoAdmin()
    await expect(demoMessageService.addReaction(sent.id, '👍')).rejects.toThrow(/access/i)
  })
})

describe('mentions', () => {
  it('records a mention of the person you are talking to', async () => {
    const target = await actAsNonOwner()
    const handle = db().profiles.find((p) => p.id === target.userId)!.displayName

    const id = await asOwner(() => demoConversationService.startDirect(ORG, target.userId))
    const sent = await asOwner(() =>
      demoMessageService.sendToConversation(id, `@${handle!} lihat ini`),
    )

    expect(db().mentions.filter((m) => m.messageId === sent.id)).toHaveLength(1)

    db().currentUserId = target.userId
    const notifications = await demoNotificationService.list(ORG)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.summary).toContain('direct message')
    // No channel name to carry: a conversation is named by who is in it.
    expect(notifications[0]?.metadata.conversation_id).toBe(id)
  })

  it('records nothing for somebody who is not in the conversation', async () => {
    const [a, b] = others(2)
    const id = await conversationBetween(a!, b!)
    const outsider = db().members.find((m) => m.userId !== a && m.userId !== b)!
    const handle = db().profiles.find((p) => p.id === outsider.userId)!.displayName

    db().currentUserId = a!
    const sent = await demoMessageService.sendToConversation(id, `@${handle!} look at this`)

    // Naming a colleague in a DM reaches nobody: they are not in it.
    expect(db().mentions.filter((m) => m.messageId === sent.id)).toHaveLength(0)

    db().currentUserId = outsider.userId
    expect(await demoNotificationService.list(ORG)).toHaveLength(0)
  })

  it('offers only the people in the conversation', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)

    const candidates = await demoConversationService.listMentionCandidates(id)
    expect(candidates.map((c) => c.userId).sort()).toEqual([owner(), other!].sort())
    // Not the roster: a DM must not become a way to enumerate anything.
    expect(candidates.length).toBeLessThan(db().members.length)
  })

  it('does not record you naming yourself', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    const me = db().profiles.find((p) => p.id === owner())!

    const sent = await demoMessageService.sendToConversation(id, `@${me.displayName!} note`)
    expect(db().mentions.filter((m) => m.messageId === sent.id)).toHaveLength(0)
  })

  it('does not notify twice when an edit keeps the mention', async () => {
    const target = await actAsNonOwner()
    const handle = db().profiles.find((p) => p.id === target.userId)!.displayName
    const id = await asOwner(() => demoConversationService.startDirect(ORG, target.userId))

    const sent = await asOwner(() => demoMessageService.sendToConversation(id, `@${handle!} first`))
    await asOwner(() => demoMessageService.edit(sent.id, `@${handle!} first, corrected`))

    db().currentUserId = target.userId
    expect(await demoNotificationService.list(ORG)).toHaveLength(1)
  })
})

describe('search', () => {
  it('finds a direct message when the conversation is named', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    await demoMessageService.sendToConversation(id, 'the needle is here')

    const hits = await demoMessageService.search({
      query: 'needle',
      channelId: null,
      conversationId: id,
    })
    expect(hits.map((h) => h.body)).toEqual(['the needle is here'])
    expect(hits[0]?.conversationId).toBe(id)
  })

  it('does not return one from an unscoped search', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    await demoMessageService.sendToConversation(id, 'the needle is here')

    // Unchanged from before conversations existed: channels only.
    expect(await demoMessageService.search({ query: 'needle', channelId: null })).toEqual([])
  })

  it('returns nothing to somebody outside the conversation, even when named', async () => {
    const [a, b] = others(2)
    const id = await conversationBetween(a!, b!)
    db().currentUserId = a!
    await demoMessageService.sendToConversation(id, 'the needle is here')

    db().currentUserId = null
    await signInAsDemoAdmin()
    expect(
      await demoMessageService.search({ query: 'needle', channelId: null, conversationId: id }),
    ).toEqual([])
  })
})

describe('read state', () => {
  it('counts what the other person said and not what you did', async () => {
    const target = await actAsNonOwner()
    const id = await asOwner(() => demoConversationService.startDirect(ORG, target.userId))

    await asOwner(() => demoMessageService.sendToConversation(id, 'one'))
    await asOwner(() => demoMessageService.sendToConversation(id, 'two'))

    // The sender has nothing unread; the recipient has two.
    expect((await asOwner(() => demoConversationService.list(ORG)))[0]?.unread).toBe(0)

    db().currentUserId = target.userId
    expect((await demoConversationService.list(ORG))[0]?.unread).toBe(2)
  })

  it('clears when the conversation is opened', async () => {
    const target = await actAsNonOwner()
    const id = await asOwner(() => demoConversationService.startDirect(ORG, target.userId))
    await asOwner(() => demoMessageService.sendToConversation(id, 'hello'))

    db().currentUserId = target.userId
    await demoConversationService.markRead(id)
    expect((await demoConversationService.list(ORG))[0]?.unread).toBe(0)
  })

  it('never moves the marker backwards', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    await demoConversationService.markRead(id)

    const first = db().conversationReads[0]!.lastReadAt
    // A stale second device catching up must not undo a newer read.
    db().conversationReads[0]!.lastReadAt = new Date(Date.now() + 60_000).toISOString()
    const ahead = db().conversationReads[0]!.lastReadAt

    await demoConversationService.markRead(id)
    expect(db().conversationReads[0]!.lastReadAt).toBe(ahead)
    expect(ahead > first).toBe(true)
  })

  it('keeps channel read state untouched', async () => {
    const [other] = others(1)
    const id = await demoConversationService.startDirect(ORG, other!)
    await demoConversationService.markRead(id)

    // Two tables, two guarantees. Marking one has no effect on the other.
    expect(db().channelReads).toHaveLength(0)
  })
})
