import { beforeEach, describe, expect, it } from 'vitest'
import { clearDemoCache, db, DEMO_OWNER_PROFILE_ID, resetDemoDatabase } from './demo-database'
import {
  demoChannelService,
  demoOrganizationService,
  demoVoiceService,
  signInAsDemoAdmin,
} from './index'

/**
 * Phase 4 · Voice — Step 1: who may be in a voice room.
 *
 * A voice channel is a channel, so the answer is the one every other channel
 * gets. This is where that is proved, because the live checks run as the
 * organization's owner — who by design passes every check — and none of the
 * interesting negatives can be posed from there.
 *
 * The subject is the port of voice_room_for(). Both it and the routine derive
 * the room name from two ids and refuse everything else with one sentence.
 */

beforeEach(async () => {
  localStorage.clear()
  clearDemoCache()
  resetDemoDatabase()
  await signInAsDemoAdmin()
})

const ORG = 'any'
const REFUSED = /do not have access to that voice channel/i

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

/** A voice channel, made the way the interface makes one. */
async function voiceChannel(isPrivate = false): Promise<string> {
  return demoChannelService.createChannel(ORG, {
    name: isPrivate ? 'ops voice' : 'team voice',
    topic: null,
    categoryId: null,
    isPrivate,
    type: 'voice',
  })
}

describe('the room name', () => {
  it('is derived from the organization and the channel, never supplied', async () => {
    const id = await voiceChannel()
    const { roomName } = await demoVoiceService.roomFor(id)

    expect(roomName).toBe(`lfghq:${db().organization.id}:voice:${id}`)
    // Nothing a caller typed is in it. A channel name is user-controlled text
    // and appears nowhere.
    expect(roomName).not.toContain('team voice')
  })

  it('is stable, so two people asking for the same channel get the same room', async () => {
    const id = await voiceChannel()
    const first = await demoVoiceService.roomFor(id)
    const second = await demoVoiceService.roomFor(id)
    expect(first.roomName).toBe(second.roomName)
  })
})

describe('who is let in', () => {
  it('lets a member into a public voice channel', async () => {
    const id = await asOwner(voiceChannel)
    await actAsNonOwner()
    await expect(demoVoiceService.roomFor(id)).resolves.toMatchObject({ channelName: 'team voice' })
  })

  it('lets the owner in, from the organization and not from a role', async () => {
    const id = await voiceChannel()
    // Signed in as the owner, who is the owner because the organization says
    // so and not because of any role they hold.
    expect(db().currentUserId).toBe(DEMO_OWNER_PROFILE_ID)
    await expect(demoVoiceService.roomFor(id)).resolves.toBeTruthy()
  })

  it('refuses somebody who is not a member at all', async () => {
    const id = await voiceChannel()
    // Signed in as somebody the organization has never heard of.
    db().currentUserId = '00000000-0000-4000-8000-000000000000'
    await expect(demoVoiceService.roomFor(id)).rejects.toThrow(REFUSED)
  })

  it('refuses a suspended member', async () => {
    const id = await asOwner(voiceChannel)
    const target = await actAsNonOwner()
    await expect(demoVoiceService.roomFor(id)).resolves.toBeTruthy()

    await asOwner(() => demoOrganizationService.suspendMember(target.id, 'Testing', 7))

    db().currentUserId = target.userId
    await expect(demoVoiceService.roomFor(id)).rejects.toThrow(REFUSED)
  })

  it('refuses a banned member', async () => {
    const id = await asOwner(voiceChannel)
    const target = await actAsNonOwner()

    await asOwner(() => demoOrganizationService.banMember(target.id, 'Testing'))

    db().currentUserId = target.userId
    await expect(demoVoiceService.roomFor(id)).rejects.toThrow(REFUSED)
  })

  it('refuses a private voice channel to somebody with no explicit allow', async () => {
    const id = await asOwner(() => voiceChannel(true))
    await actAsNonOwner()
    await expect(demoVoiceService.roomFor(id)).rejects.toThrow(REFUSED)
  })

  it('lets them in once a role they hold is allowed in', async () => {
    const id = await asOwner(() => voiceChannel(true))
    const target = await actAsNonOwner()

    await asOwner(() =>
      demoChannelService.setOverride(id, target.role.id, 'channels.view', 'allow'),
    )

    db().currentUserId = target.userId
    await expect(demoVoiceService.roomFor(id)).resolves.toBeTruthy()
  })

  it('refuses when a role they hold is denied, whatever else allows it', async () => {
    const id = await asOwner(voiceChannel)
    const target = await actAsNonOwner()

    await asOwner(() => demoChannelService.setOverride(id, target.role.id, 'channels.view', 'deny'))

    db().currentUserId = target.userId
    await expect(demoVoiceService.roomFor(id)).rejects.toThrow(REFUSED)
  })

  it('reads nothing into the name of a role', async () => {
    // The same member, the same permissions, under two names. A rule that
    // consulted the name would answer differently.
    const id = await asOwner(voiceChannel)
    const target = await actAsNonOwner('Player')
    const asPlayer = await demoVoiceService.roomFor(id).then(
      (r) => r.roomName,
      () => null,
    )

    await asOwner(() => demoOrganizationService.updateMemberRole(target.id, target.role.id))
    db().currentUserId = target.userId
    const again = await demoVoiceService.roomFor(id).then(
      (r) => r.roomName,
      () => null,
    )

    expect(asPlayer).not.toBeNull()
    expect(again).toBe(asPlayer)
  })
})

describe('what cannot be asked for', () => {
  it('refuses a channel that does not exist', async () => {
    await expect(demoVoiceService.roomFor('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      REFUSED,
    )
  })

  it('refuses a text channel, so a text id cannot become a room', async () => {
    const text = db().channels.find((c) => c.type === 'text')!
    await expect(demoVoiceService.roomFor(text.id)).rejects.toThrow(REFUSED)
  })

  it('refuses an archived voice channel', async () => {
    const id = await voiceChannel()
    await demoChannelService.updateChannel(id, { archived: true })
    await expect(demoVoiceService.roomFor(id)).rejects.toThrow(REFUSED)
  })

  it('refuses a channel belonging to another organization', async () => {
    const id = await voiceChannel()
    // The membership lookup is against the channel's organization. Move the
    // channel and the caller stops being a member of the place it is in.
    db().channels.find((c) => c.id === id)!.organizationId = '11111111-1111-4111-8111-111111111111'
    await expect(demoVoiceService.roomFor(id)).rejects.toThrow(REFUSED)
  })

  it('says the same thing however it refuses', async () => {
    // An id that does not exist, an id that is a text channel and an id that
    // is somebody else's private room must be indistinguishable, or the
    // refusals become a way to map what exists.
    const text = db().channels.find((c) => c.type === 'text')!
    const secret = await asOwner(() => voiceChannel(true))
    await actAsNonOwner()

    const messages = await Promise.all(
      ['00000000-0000-4000-8000-000000000000', text.id, secret].map((id) =>
        demoVoiceService.roomFor(id).then(
          () => 'ALLOWED',
          (error: Error) => error.message,
        ),
      ),
    )
    expect(new Set(messages).size).toBe(1)
    expect(messages[0]).toMatch(REFUSED)
  })
})

describe('the audit trail', () => {
  it('records being let in, once', async () => {
    const id = await voiceChannel()
    await demoVoiceService.roomFor(id)

    const joins = db().auditLogs.filter((entry) => entry.action === 'voice.join')
    expect(joins).toHaveLength(1)
    expect(joins[0]?.entityId).toBe(id)
  })

  it('records nothing for somebody who was refused', async () => {
    const id = await asOwner(() => voiceChannel(true))
    await actAsNonOwner()
    await demoVoiceService.roomFor(id).catch(() => undefined)

    expect(db().auditLogs.filter((entry) => entry.action === 'voice.join')).toHaveLength(0)
  })
})
