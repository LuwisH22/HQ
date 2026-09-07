import { beforeEach, describe, expect, it } from 'vitest'
import { clearDemoCache, db, resetDemoDatabase } from './demo-database'
import {
  demoChannelService,
  demoConversationService,
  demoMessageService,
  demoNotificationService,
  demoOrganizationService,
  signInAsDemoAdmin,
} from './index'

/**
 * Phase 2 · C3 — durable mentions.
 *
 * C2 proved who gets *notified*. What is new here is the row: a mention is now
 * recorded, so it can be read back and rendered. The rows must obey the same
 * rule the notification did — a mention of somebody who cannot see the channel
 * is not a mention — and they must survive an edit without notifying twice.
 *
 * As with the rest of the demo suites, this is where "somebody who cannot see
 * it gets nothing" is proved: the live checks run as the owner, who
 * short-circuits every channel rule by design.
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

/** The handle the mention pass resolves somebody by. */
function handleOf(userId: string): string {
  const profile = db().profiles.find((p) => p.id === userId)
  return profile?.displayName ?? profile!.email.split('@')[0]!
}

const mentionsOn = (messageId: string) => db().mentions.filter((m) => m.messageId === messageId)

describe('the handle the menu offers', () => {
  /** Give somebody a display name and read back what they would be offered as. */
  async function offeredHandleFor(displayName: string | null, email?: string) {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const profile = db().profiles.find((p) => p.id === target.userId)!
    profile.displayName = displayName
    if (email) profile.email = email

    const offered = await asOwner(() => demoChannelService.listMentionCandidates(channel.id))
    return { target, channel, candidate: offered.find((c) => c.userId === target.userId) }
  }

  it('offers a display name the mention pass can capture', async () => {
    const { candidate } = await offeredHandleFor('Adit')
    expect(candidate?.handle).toBe('Adit')
  })

  it('keeps the characters the pass allows', async () => {
    const { candidate } = await offeredHandleFor('Adit_123')
    expect(candidate?.handle).toBe('Adit_123')
  })

  it('falls back to the address when the name has a space in it', async () => {
    // "@Adit si keren" is read by the pass as "@Adit", which is nobody. The
    // menu must not insert something that quietly does not happen.
    const { candidate } = await offeredHandleFor('Adit si keren', 'adit@lfg.gg')
    expect(candidate?.handle).toBe('adit')
    // The person is still called what they are called; only the handle moved.
    expect(candidate?.displayName).toBe('Adit si keren')
  })

  it('falls back for a name the pass cannot read at all', async () => {
    const { candidate } = await offeredHandleFor('Adit!! ⭐', 'adit@lfg.gg')
    expect(candidate?.handle).toBe('adit')
  })

  it('offers nobody a handle that could never resolve', async () => {
    // Neither half is capturable, so there is no way to name this person and
    // the menu says so by leaving them out.
    const { candidate } = await offeredHandleFor('Adit si keren', 'adit+hq@lfg.gg')
    expect(candidate).toBeUndefined()
  })

  it('offers a handle that actually records a mention', async () => {
    // The whole point, end to end: what the menu inserts, the pass resolves.
    const { target, channel, candidate } = await offeredHandleFor('Adit si keren', 'adit@lfg.gg')
    const sent = await asOwner(() =>
      demoMessageService.send(channel.id, `yo @${candidate!.handle} cek ini`),
    )

    expect(mentionsOn(sent.id)).toEqual([
      { messageId: sent.id, userId: target.userId, handle: candidate!.handle.toLowerCase() },
    ])
  })

  it('records nothing for the spaced name it used to offer', async () => {
    // The bug, preserved as a test. The address deliberately shares nothing
    // with the name, so the first word of the name resolves to nobody —
    // which is what the old menu inserted and what nobody was ever notified
    // of.
    const { target, channel, candidate } = await offeredHandleFor('Adit si keren', 'luwis@lfg.gg')
    expect(candidate?.handle).toBe('luwis')

    const old = await asOwner(() =>
      demoMessageService.send(channel.id, 'yo @Adit si keren cek ini'),
    )
    expect(mentionsOn(old.id)).toEqual([])

    // And what the menu offers now does reach them.
    const fixed = await asOwner(() =>
      demoMessageService.send(channel.id, `yo @${candidate!.handle} cek ini`),
    )
    expect(mentionsOn(fixed.id)).toEqual([
      { messageId: fixed.id, userId: target.userId, handle: 'luwis' },
    ])
  })

  it('offers the same rule inside a conversation', async () => {
    const others = db()
      .members.map((m) => m.userId)
      .filter((id) => id !== db().currentUserId)
    const [a, b] = others
    const profile = db().profiles.find((p) => p.id === b)!
    profile.displayName = 'Adit si keren'
    profile.email = 'adit@lfg.gg'

    db().currentUserId = a!
    const conversation = await demoConversationService.startDirect('any', b!)
    const offered = await demoConversationService.listMentionCandidates(conversation)
    expect(offered.find((c) => c.userId === b)?.handle).toBe('adit')
  })
})

describe('recording a mention', () => {
  it('records who was named, and the handle they were named by', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    const sent = await asOwner(() => demoMessageService.send(channel.id, `yo @${handle} cek ini`))

    expect(mentionsOn(sent.id)).toEqual([
      { messageId: sent.id, userId: target.userId, handle: handle.toLowerCase() },
    ])
  })

  it('reads back through the service, keyed by message', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)
    const sent = await asOwner(() => demoMessageService.send(channel.id, `@${handle} hi`))

    const byMessage = await asOwner(() => demoMessageService.listMentions([sent.id]))
    expect(byMessage.get(sent.id)).toEqual([
      { userId: target.userId, handle: handle.toLowerCase() },
    ])
  })

  it('records several people named in one message', async () => {
    const channel = publicChannel()
    const others = (await demoChannelService.listMentionCandidates(channel.id))
      .filter((c) => c.userId !== db().currentUserId)
      .slice(0, 2)

    const sent = await demoMessageService.send(
      channel.id,
      `${others.map((c) => `@${c.handle}`).join(' and ')} scrim at 8`,
    )

    expect(
      mentionsOn(sent.id)
        .map((m) => m.userId)
        .sort(),
    ).toEqual(others.map((c) => c.userId).sort())
  })

  it('records one row however many times somebody is named', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    const sent = await asOwner(() =>
      demoMessageService.send(channel.id, `@${handle} @${handle} @${handle}`),
    )
    expect(mentionsOn(sent.id)).toHaveLength(1)
  })

  it('records nothing for a handle nobody holds', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'ping @nobodyatall please')
    expect(mentionsOn(sent.id)).toHaveLength(0)
  })

  it('leaves an ordinary @ alone', async () => {
    // An address is not a mention, and a bare @ is not a handle.
    const sent = await demoMessageService.send(publicChannel().id, 'mail riley@lfg.gg or @ 8pm')
    expect(mentionsOn(sent.id)).toHaveLength(0)
  })

  it('reads through punctuation around the handle', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    const sent = await asOwner(() => demoMessageService.send(channel.id, `(@${handle}), ready?`))
    expect(mentionsOn(sent.id)).toHaveLength(1)
  })

  it('does not record you naming yourself', async () => {
    const me = db().currentUserId!
    const sent = await demoMessageService.send(publicChannel().id, `@${handleOf(me)} note to self`)
    expect(mentionsOn(sent.id)).toHaveLength(0)
  })
})

describe('eligibility', () => {
  it('does not record a mention of somebody who cannot see the channel', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    const sent = await asOwner(() => demoMessageService.send(secret.id, `@${handle} classified`))

    // A row here would be a record of a message in a channel they cannot open.
    expect(mentionsOn(sent.id)).toHaveLength(0)
  })

  it('records it once they are allowed into the private channel', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    await asOwner(() =>
      demoChannelService.setOverride(secret.id, target.role.id, 'channels.view', 'allow'),
    )
    const sent = await asOwner(() => demoMessageService.send(secret.id, `@${handle} now you can`))

    expect(mentionsOn(sent.id)).toHaveLength(1)
  })

  it('does not record a mention of a suspended member', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)
    await asOwner(() => demoOrganizationService.suspendMember(target.id, 'Testing', 7))

    const sent = await asOwner(() => demoMessageService.send(channel.id, `@${handle} hello?`))
    expect(mentionsOn(sent.id)).toHaveLength(0)
  })

  it('does not record a mention of a banned member', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)
    await asOwner(() => demoOrganizationService.banMember(target.id, 'Testing'))

    const sent = await asOwner(() => demoMessageService.send(channel.id, `@${handle} hello?`))
    expect(mentionsOn(sent.id)).toHaveLength(0)
  })

  it('hides the rows from somebody who cannot read the message', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)
    await asOwner(() =>
      demoChannelService.setOverride(secret.id, target.role.id, 'channels.view', 'allow'),
    )
    const sent = await asOwner(() => demoMessageService.send(secret.id, `@${handle} classified`))
    expect(mentionsOn(sent.id)).toHaveLength(1)

    const inside = new Set(await asOwner(() => demoChannelService.listChannelMembers(secret.id)))
    const outsider = db().members.find((m) => !inside.has(m.userId))
    if (!outsider) throw new Error('the private channel admits everybody')

    db().currentUserId = outsider.userId
    expect((await demoMessageService.listMentions([sent.id])).get(sent.id)).toBeUndefined()
  })
})

describe('who the composer may offer', () => {
  it('offers exactly the people the channel would deliver to', async () => {
    const channel = publicChannel()
    const candidates = await demoChannelService.listMentionCandidates(channel.id)

    expect(candidates.map((c) => c.userId)).toEqual(
      await demoChannelService.listChannelMembers(channel.id),
    )
    expect(candidates.every((c) => c.handle.length > 0)).toBe(true)
  })

  it('offers only the roles allowed into a private channel', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()

    const before = await asOwner(() => demoChannelService.listMentionCandidates(secret.id))
    expect(before.map((c) => c.userId)).not.toContain(target.userId)

    await asOwner(() =>
      demoChannelService.setOverride(secret.id, target.role.id, 'channels.view', 'allow'),
    )
    const after = await asOwner(() => demoChannelService.listMentionCandidates(secret.id))
    expect(after.map((c) => c.userId)).toContain(target.userId)
  })

  it('offers nobody to a member who cannot see the channel', async () => {
    const secret = privateChannel()
    await actAsNonOwner()
    // Empty rather than an error: a guessed id must look like an empty channel.
    expect(await demoChannelService.listMentionCandidates(secret.id)).toEqual([])
  })
})

describe('notifying', () => {
  it('notifies the person named once, however many times they are named', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    await asOwner(() => demoMessageService.send(channel.id, `@${handle} @${handle} twice`))

    db().currentUserId = target.userId
    expect(await demoNotificationService.list('any')).toHaveLength(1)
  })

  it('does not notify a second time when an edit keeps the mention', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    const sent = await asOwner(() => demoMessageService.send(channel.id, `@${handle} first`))
    await asOwner(() => demoMessageService.edit(sent.id, `@${handle} first, corrected`))

    expect(mentionsOn(sent.id)).toHaveLength(1)
    db().currentUserId = target.userId
    expect(await demoNotificationService.list('any')).toHaveLength(1)
  })

  it('notifies somebody an edit adds', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    const sent = await asOwner(() => demoMessageService.send(channel.id, 'no names yet'))
    expect(mentionsOn(sent.id)).toHaveLength(0)

    await asOwner(() => demoMessageService.edit(sent.id, `actually @${handle}`))

    expect(mentionsOn(sent.id)).toHaveLength(1)
    db().currentUserId = target.userId
    expect(await demoNotificationService.list('any')).toHaveLength(1)
  })

  it('records and notifies a mention made in a thread', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    const reply = await asOwner(async () => {
      const root = await demoMessageService.send(channel.id, 'root')
      return demoMessageService.send(channel.id, `@${handle} in the thread`, root.id)
    })

    expect(mentionsOn(reply.id)).toHaveLength(1)
    db().currentUserId = target.userId
    expect(await demoNotificationService.list('any')).toHaveLength(1)
  })
})

describe('deleting', () => {
  it('forgets the mentions when the message is deleted', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const handle = handleOf(target.userId)

    const sent = await asOwner(() => demoMessageService.send(channel.id, `@${handle} oops`))
    expect(mentionsOn(sent.id)).toHaveLength(1)

    await asOwner(() => demoMessageService.remove(sent.id))

    // There are no words left to have named anybody in.
    expect(mentionsOn(sent.id)).toHaveLength(0)
    expect((await asOwner(() => demoMessageService.listMentions([sent.id]))).size).toBe(0)
  })
})
