import { beforeEach, describe, expect, it } from 'vitest'
import { clearDemoCache, db, DEMO_OWNER_PROFILE_ID, resetDemoDatabase } from './demo-database'
import {
  demoAttachmentService,
  demoChannelService,
  demoConversationService,
  demoMessageService,
  demoOrganizationService,
  signInAsDemoAdmin,
} from './index'

/**
 * Phase 2 · C3 — attachments.
 *
 * The rules that matter are about who may attach and who may see, and both are
 * the message's rules rather than new ones. This is where they are proved,
 * because the live checks run as the organization's owner — who can see every
 * channel by design and is nobody special inside a conversation, so neither
 * negative can be posed from there.
 */

beforeEach(async () => {
  localStorage.clear()
  clearDemoCache()
  resetDemoDatabase()
  await signInAsDemoAdmin()
})

const ORG = 'any'
const owner = () => DEMO_OWNER_PROFILE_ID

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

const publicChannel = () => db().channels.find((c) => !c.isPrivate)!
const privateChannel = () => db().channels.find((c) => c.isPrivate)!

/** A file, without a browser to make one. */
function fileOf(name = 'shot.png', type = 'image/png', size = 64): File {
  return { name, type, size } as File
}

/** Upload and attach in one go, as the composer does. */
async function attachTo(messageId: string, file = fileOf()) {
  const upload = await demoAttachmentService.upload(file)
  await demoAttachmentService.attach(messageId, [upload])
  return upload
}

describe('uploading', () => {
  it('puts the object under the uploader, which is the only prefix storage takes', async () => {
    const upload = await demoAttachmentService.upload(fileOf())
    expect(upload.storagePath.split('/')[0]).toBe(owner())
  })

  it('refuses a kind of file that cannot be attached', async () => {
    await expect(
      demoAttachmentService.upload(fileOf('run.sh', 'application/x-sh')),
    ).rejects.toThrow(/not a kind of file/i)
  })

  it('refuses a file over 25 MB', async () => {
    await expect(
      demoAttachmentService.upload(fileOf('big.zip', 'application/zip', 26 * 1024 * 1024)),
    ).rejects.toThrow(/limit/i)
  })
})

describe('attaching', () => {
  it('records a file against your own message', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'with a file')
    const upload = await attachTo(sent.id)

    const byMessage = await demoAttachmentService.listFor([sent.id])
    expect(byMessage.get(sent.id)).toHaveLength(1)
    expect(byMessage.get(sent.id)?.[0]?.storagePath).toBe(upload.storagePath)
    expect(byMessage.get(sent.id)?.[0]?.fileName).toBe('shot.png')
  })

  it("refuses somebody else's message", async () => {
    const sent = await asOwner(() => demoMessageService.send(publicChannel().id, 'mine'))
    await actAsNonOwner()

    const upload = await demoAttachmentService.upload(fileOf())
    await expect(demoAttachmentService.attach(sent.id, [upload])).rejects.toThrow(/your own/i)
  })

  it('refuses a deleted message', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'about to go')
    const upload = await demoAttachmentService.upload(fileOf())
    await demoMessageService.remove(sent.id)

    await expect(demoAttachmentService.attach(sent.id, [upload])).rejects.toThrow(/your own/i)
  })

  it("refuses somebody else's object", async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'mine')
    await expect(
      demoAttachmentService.attach(sent.id, [
        {
          storagePath: '00000000-0000-4000-8000-000000000000/whatever',
          fileName: 'theirs.png',
          mimeType: 'image/png',
          byteSize: 1,
        },
      ]),
    ).rejects.toThrow(/does not belong to you/i)
  })

  it('refuses the same object twice', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'once')
    const upload = await attachTo(sent.id)

    const second = await demoMessageService.send(publicChannel().id, 'twice')
    await expect(demoAttachmentService.attach(second.id, [upload])).rejects.toThrow(/already/i)
  })

  it('refuses a member who may not send in the channel', async () => {
    const channel = publicChannel()
    const target = await actAsNonOwner()
    const sent = await demoMessageService.send(channel.id, 'before the deny')

    await asOwner(() =>
      demoChannelService.setOverride(channel.id, target.role.id, 'messages.send', 'deny'),
    )

    db().currentUserId = target.userId
    const upload = await demoAttachmentService.upload(fileOf())
    await expect(demoAttachmentService.attach(sent.id, [upload])).rejects.toThrow(/cannot post/i)
  })

  it('refuses a suspended member', async () => {
    const target = await actAsNonOwner()
    const sent = await demoMessageService.send(publicChannel().id, 'before the suspension')
    const upload = await demoAttachmentService.upload(fileOf())

    await asOwner(() => demoOrganizationService.suspendMember(target.id, 'Testing', 7))

    db().currentUserId = target.userId
    await expect(demoAttachmentService.attach(sent.id, [upload])).rejects.toThrow(/cannot post/i)
  })

  it('refuses a banned member', async () => {
    const target = await actAsNonOwner()
    const sent = await demoMessageService.send(publicChannel().id, 'before the ban')
    const upload = await demoAttachmentService.upload(fileOf())

    await asOwner(() => demoOrganizationService.banMember(target.id, 'Testing'))

    db().currentUserId = target.userId
    await expect(demoAttachmentService.attach(sent.id, [upload])).rejects.toThrow(/cannot post/i)
  })
})

describe('who can see one', () => {
  it('hides an attachment on a message the reader cannot read', async () => {
    const secret = privateChannel()
    const sent = await asOwner(() => demoMessageService.send(secret.id, 'classified'))
    await asOwner(() => attachTo(sent.id))

    await actAsNonOwner()
    expect((await demoAttachmentService.listFor([sent.id])).get(sent.id)).toBeUndefined()
  })

  it('signs no url for an object on a message the reader cannot read', async () => {
    const secret = privateChannel()
    const sent = await asOwner(() => demoMessageService.send(secret.id, 'classified'))
    const upload = await asOwner(() => attachTo(sent.id))

    await actAsNonOwner()
    expect((await demoAttachmentService.signedUrls([upload.storagePath])).size).toBe(0)
  })

  it('shows it once the reader is allowed into the channel', async () => {
    const secret = privateChannel()
    const target = await actAsNonOwner()
    const sent = await asOwner(() => demoMessageService.send(secret.id, 'classified'))
    await asOwner(() => attachTo(sent.id))

    await asOwner(() =>
      demoChannelService.setOverride(secret.id, target.role.id, 'channels.view', 'allow'),
    )

    db().currentUserId = target.userId
    expect((await demoAttachmentService.listFor([sent.id])).get(sent.id)).toHaveLength(1)
  })
})

describe('in a conversation', () => {
  it('travels with a direct message, and reaches nobody else', async () => {
    const others = db()
      .members.map((m) => m.userId)
      .filter((id) => id !== owner())
    const [a, b] = others

    db().currentUserId = a!
    const conversation = await demoConversationService.startDirect(ORG, b!)
    const sent = await demoMessageService.sendToConversation(conversation, 'for you')
    const upload = await attachTo(sent.id)

    expect((await demoAttachmentService.listFor([sent.id])).get(sent.id)).toHaveLength(1)

    // The owner of the organization, who is nobody special inside a DM.
    db().currentUserId = null
    await signInAsDemoAdmin()
    expect((await demoAttachmentService.listFor([sent.id])).get(sent.id)).toBeUndefined()
    expect((await demoAttachmentService.signedUrls([upload.storagePath])).size).toBe(0)
  })

  it('refuses somebody outside the conversation', async () => {
    const others = db()
      .members.map((m) => m.userId)
      .filter((id) => id !== owner())
    const [a, b] = others

    db().currentUserId = a!
    const conversation = await demoConversationService.startDirect(ORG, b!)
    const sent = await demoMessageService.sendToConversation(conversation, 'ours')

    db().currentUserId = null
    await signInAsDemoAdmin()
    const upload = await demoAttachmentService.upload(fileOf())
    await expect(demoAttachmentService.attach(sent.id, [upload])).rejects.toThrow(/your own/i)
  })
})

describe('in a thread', () => {
  it('attaches to a reply the same way it attaches to anything else', async () => {
    const root = await demoMessageService.send(publicChannel().id, 'root')
    const reply = await demoMessageService.send(publicChannel().id, 'reply', root.id)
    await attachTo(reply.id, fileOf('notes.txt', 'text/plain', 12))

    const byMessage = await demoAttachmentService.listFor([root.id, reply.id])
    expect(byMessage.get(reply.id)).toHaveLength(1)
    expect(byMessage.get(root.id)).toBeUndefined()
  })
})

describe('lifecycle', () => {
  it('forgets the attachment when the message is deleted', async () => {
    const sent = await demoMessageService.send(publicChannel().id, 'with a file')
    await attachTo(sent.id)

    await demoMessageService.remove(sent.id)

    // A file listed under a message whose words are gone is residue.
    expect(db().attachments.filter((a) => a.messageId === sent.id)).toHaveLength(0)
    expect((await demoAttachmentService.listFor([sent.id])).get(sent.id)).toBeUndefined()
  })

  it('lets the uploader discard an object they never sent', async () => {
    const upload = await demoAttachmentService.upload(fileOf())
    expect((await demoAttachmentService.signedUrls([upload.storagePath])).size).toBe(1)

    await demoAttachmentService.discard([upload.storagePath])
    expect((await demoAttachmentService.signedUrls([upload.storagePath])).size).toBe(0)
  })

  it("does not let anybody discard somebody else's object", async () => {
    const upload = await asOwner(() => demoAttachmentService.upload(fileOf()))

    await actAsNonOwner()
    await demoAttachmentService.discard([upload.storagePath])

    // Still there for the person it belongs to.
    expect((await asOwner(() => demoAttachmentService.signedUrls([upload.storagePath]))).size).toBe(
      1,
    )
  })
})
