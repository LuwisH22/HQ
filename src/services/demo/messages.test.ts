import { beforeEach, describe, expect, it } from 'vitest'
import { clearDemoCache, db, resetDemoDatabase } from './demo-database'
import {
  demoChannelService,
  demoMessageService,
  demoOrganizationService,
  signInAsDemoAdmin,
} from './index'
import { describeTyping } from '@/features/channels/use-channel-realtime'

/**
 * Phase 2 · C1 — messages.
 *
 * The live verification runs as the owner, who short-circuits every channel
 * check by design, so the rules that matter for other people — private channel
 * visibility, editing being an author's right, moderation being removal and not
 * rewriting, suspension cutting off chat — are proved here against a faithful
 * port of the resolver.
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

  // Re-read: the member captured above still carries the role they held
  // BEFORE the line above changed it, and overrides keyed off that stale id
  // silently apply to the wrong role.
  const refreshed = (await demoOrganizationService.listMembers('any')).find(
    (m) => m.id === target.id,
  )
  return refreshed ?? target
}

// The channel the seed actually put messages in, not merely the first public
// one — otherwise the history test reads an empty channel and proves nothing.
const publicChannel = () => {
  const withHistory = db().messages[0]?.channelId
  return (
    db().channels.find((c) => !c.isPrivate && c.id === withHistory) ??
    db().channels.find((c) => !c.isPrivate)!
  )
}
const privateChannel = () => db().channels.find((c) => c.isPrivate)!

describe('sending and reading', () => {
  it('returns the seeded history oldest-first', async () => {
    const page = await demoMessageService.list(publicChannel().id)
    expect(page.messages.length).toBeGreaterThan(0)
    const times = page.messages.map((m) => m.createdAt)
    expect([...times].sort()).toEqual(times)
  })

  it('sends a message attributed to the session, not the caller', async () => {
    const channel = publicChannel()
    const sent = await demoMessageService.send(channel.id, '  gg wp  ')

    expect(sent.body).toBe('gg wp')
    expect(sent.authorId).toBe(db().currentUserId)
    expect(sent.editedAt).toBeNull()
    expect(sent.deletedAt).toBeNull()
  })

  it('refuses an empty message', async () => {
    await expect(demoMessageService.send(publicChannel().id, '   ')).rejects.toThrow(/empty/i)
  })

  it('refuses to post in a channel the member cannot see', async () => {
    const secret = privateChannel()
    await actAsNonOwner()

    await expect(demoMessageService.send(secret.id, 'let me in')).rejects.toThrow(/cannot post/i)
  })

  it('refuses to read a private channel without an explicit allow', async () => {
    const secret = privateChannel()
    await actAsNonOwner()

    await expect(demoMessageService.list(secret.id)).rejects.toThrow(/access/i)
  })

  it('lets a member read a private channel once their role is allowed', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoChannelService.setOverride(secret.id, target.role.id, 'channels.view', 'allow')

    db().currentUserId = target.userId
    await expect(demoMessageService.list(secret.id)).resolves.toBeTruthy()
  })
})

describe('editing belongs to the author', () => {
  it('lets the author rewrite their own message and stamps it', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'orignal typo')
    await demoMessageService.edit(sent.id, 'original, fixed')

    const after = await demoMessageService.getById(sent.id)
    expect(after?.body).toBe('original, fixed')
    expect(after?.editedAt).not.toBeNull()
  })

  it('refuses to let anyone else rewrite it — moderation is removal, not rewriting', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'said by the owner')

    // A moderator, acting on someone else's words.
    await actAsNonOwner('Manager')
    await expect(demoMessageService.edit(sent.id, 'words put in their mouth')).rejects.toThrow(
      /only edit your own/i,
    )
  })

  it('refuses to edit a deleted message', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'about to go')
    await demoMessageService.remove(sent.id)

    await expect(demoMessageService.edit(sent.id, 'back again')).rejects.toThrow(/deleted/i)
  })
})

describe('deletion', () => {
  it('soft-deletes: the row survives, the words do not', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'to be removed')
    await demoMessageService.remove(sent.id)

    const after = await demoMessageService.getById(sent.id)
    expect(after).not.toBeNull()
    expect(after?.body).toBe('')
    expect(after?.deletedAt).not.toBeNull()
  })

  it('lets an author remove their own without an audit entry', async () => {
    const before = db().auditLogs.length
    const sent = await demoMessageService.send(publicChannel().id, 'my own typo')
    await demoMessageService.remove(sent.id)

    // Auditing every author tidying up would bury the entries that matter.
    expect(db().auditLogs.length).toBe(before)
  })

  it('audits a moderator removing somebody else’s message', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'posted by the owner')
    const target = await actAsNonOwner('Manager')
    expect(target).toBeTruthy()

    await demoMessageService.remove(sent.id, 'off topic')
    expect(db().auditLogs[0]?.action).toBe('message.deleted')
  })

  it('refuses when the actor is neither the author nor a moderator', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'not yours')
    await actAsNonOwner('Player')

    await expect(demoMessageService.remove(sent.id)).rejects.toThrow(/only delete your own/i)
  })

  it('refuses to delete twice', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'once')
    await demoMessageService.remove(sent.id)
    await expect(demoMessageService.remove(sent.id)).rejects.toThrow(/already been deleted/i)
  })
})

describe('pinning', () => {
  it('pins and unpins with the permission', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'worth keeping')
    await demoMessageService.setPinned(sent.id, true)
    expect((await demoMessageService.getById(sent.id))?.pinnedAt).not.toBeNull()

    await demoMessageService.setPinned(sent.id, false)
    expect((await demoMessageService.getById(sent.id))?.pinnedAt).toBeNull()
  })

  it('refuses without messages.pin', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'not pinnable by them')
    await actAsNonOwner('Player')

    await expect(demoMessageService.setPinned(sent.id, true)).rejects.toThrow(/permission/i)
  })
})

describe('moderation status gates chat', () => {
  it('a suspended member can neither read nor post', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoOrganizationService.suspendMember(target.id, 'Testing', 7)

    db().currentUserId = target.userId
    await expect(demoMessageService.list(channel.id)).rejects.toThrow(/access/i)
    await expect(demoMessageService.send(channel.id, 'hello?')).rejects.toThrow(/cannot post/i)
  })

  it('a banned member can neither read nor post', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoOrganizationService.banMember(target.id, 'Testing')

    db().currentUserId = target.userId
    await expect(demoMessageService.list(channel.id)).rejects.toThrow(/access/i)
  })

  it('an expired suspension restores chat with nothing written', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoOrganizationService.suspendMember(target.id, 'Testing', 1)

    const stored = db().members.find((m) => m.id === target.id)!
    stored.suspendedUntil = new Date(Date.now() - 1000).toISOString()

    db().currentUserId = target.userId
    await expect(demoMessageService.list(channel.id)).resolves.toBeTruthy()
    expect(stored.status).toBe('suspended')
  })

  it('a deny override on messages.send silences a member who can still read', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()

    db().currentUserId = null
    await signInAsDemoAdmin()
    await demoChannelService.setOverride(channel.id, target.role.id, 'messages.send', 'deny')

    db().currentUserId = target.userId
    await expect(demoMessageService.list(channel.id)).resolves.toBeTruthy()
    await expect(demoMessageService.send(channel.id, 'muted')).rejects.toThrow(/cannot post/i)
  })
})

describe('typing indicator wording', () => {
  it('says nothing when nobody is typing', () => {
    expect(describeTyping([])).toBeNull()
  })

  it('names one person', () => {
    expect(describeTyping(['Riley'])).toBe('Riley is typing')
  })

  it('names two', () => {
    expect(describeTyping(['Riley', 'Noor'])).toBe('Riley and Noor are typing')
  })

  it('counts the rest beyond two', () => {
    expect(describeTyping(['Riley', 'Noor', 'Sam'])).toBe('Riley, Noor, and 1 other are typing')
    expect(describeTyping(['Riley', 'Noor', 'Sam', 'Ada', 'Kit'])).toBe(
      'Riley, Noor, and 3 others are typing',
    )
  })
})
