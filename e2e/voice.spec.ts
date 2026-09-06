import { expect, test, type Page } from '@playwright/test'
import { closeNav, createChannel, deleteChannel, openNav, uniqueName } from './channel-helpers'

/**
 * Phase 4 · Voice — the room, through the real interface.
 *
 * These tests talk to LiveKit Cloud for real: a token is minted by the Edge
 * Function, a room is joined, a microphone is published, and the participant
 * list is LiveKit's own. Chrome supplies a fake device so there is a
 * microphone to publish and nobody has to click a permission prompt.
 *
 * Who is allowed in is proved in the unit suite and against the live
 * database — this session is the organization's owner, who passes every check
 * by design. What is proved here is the session: that it starts, that the
 * controls do what they say, that it ends, and that the microphone stops.
 *
 * One thing is deliberately not proved: two people hearing each other. There
 * is one credential in this suite, and LiveKit removes a duplicate identity
 * from a room rather than seating it twice — so a second real participant
 * cannot be conjured without a second account, and a faked one would prove
 * nothing.
 */

test.use({
  storageState: '.auth/owner.json',
  permissions: ['microphone'],
  launchOptions: {
    args: [
      // A microphone that exists and needs no prompt. Without these the join
      // would wait on a dialog no test can click.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
})

const status = (page: Page) => page.locator('[data-voice-status]')
const people = (page: Page, name: string) => page.getByRole('list', { name: `People in ${name}` })
const controls = (page: Page) => page.getByRole('group', { name: 'Voice controls' })

/** Remember every microphone this page opens, so Leave can be checked. */
async function watchMicrophones(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const opened: MediaStreamTrack[] = []
    ;(window as unknown as { __micTracks: MediaStreamTrack[] }).__micTracks = opened

    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await real(constraints)
      opened.push(...stream.getAudioTracks())
      return stream
    }
  })
}

const liveTracks = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __micTracks?: MediaStreamTrack[] }).__micTracks?.filter(
        (track) => track.readyState === 'live',
      ).length ?? 0,
  )

async function joinVoice(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Join voice' }).click()
  await expect(status(page)).toHaveAttribute('data-voice-status', 'connected', {
    timeout: 45_000,
  })
  await expect(people(page, name)).toBeVisible()
}

async function leaveVoice(page: Page): Promise<void> {
  await controls(page).getByRole('button', { name: 'Leave voice' }).click()
  await expect(status(page)).toHaveAttribute('data-voice-status', 'idle', { timeout: 20_000 })
}

test('shows a voice channel as a voice channel, and opens a room rather than a chat', async ({
  page,
}, testInfo) => {
  const name = uniqueName('voice', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })

  // In the sidebar, among the ordinary channels, with its own icon.
  await openNav(page)
  await expect(
    page.getByRole('link', { name: new RegExp(name) }).getByLabel('Voice channel'),
  ).toBeVisible()
  await closeNav(page)

  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 })

  // What is absent is the point: a voice channel is not a place for messages.
  await expect(page.getByRole('textbox', { name: `Message ${name}` })).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Messages', exact: true })).toHaveCount(0)

  await expect(status(page)).toHaveAttribute('data-voice-status', 'idle')
  await expect(page.getByRole('button', { name: 'Join voice' })).toBeEnabled()
  // Nothing to control until there is a room, and nothing has asked for a
  // microphone yet either.
  await expect(controls(page)).toHaveCount(0)

  await deleteChannel(page, name)
})

test('joins, seats the person who joined, and takes the microphone back on leave', async ({
  page,
}, testInfo) => {
  const name = uniqueName('voicejoin', testInfo.project.name)
  await watchMicrophones(page)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })

  expect(await liveTracks(page)).toBe(0)

  await joinVoice(page, name)

  // The local participant is in the room, named, and marked as you.
  const rows = people(page, name).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toHaveAttribute('data-participant-local', 'true')
  await expect(rows.first()).toHaveAccessibleName(/\(you\)/)

  // The microphone published, and is not muted.
  await expect.poll(() => liveTracks(page), { timeout: 15_000 }).toBeGreaterThan(0)
  await expect(rows.first()).toHaveAttribute('data-participant-state', /speaking|listening/)
  await expect(controls(page).getByRole('button', { name: 'Mute microphone' })).toBeVisible()

  await leaveVoice(page)
  await expect(controls(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Join voice' })).toBeVisible()

  // The thing that actually matters: no microphone is still open.
  await expect.poll(() => liveTracks(page), { timeout: 15_000 }).toBe(0)

  await deleteChannel(page, name)
})

test('mutes and unmutes without dropping the room', async ({ page }, testInfo) => {
  const name = uniqueName('voicemute', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })
  await joinVoice(page, name)

  const you = people(page, name).getByRole('listitem').first()
  const bar = controls(page)

  await bar.getByRole('button', { name: 'Mute microphone' }).click()
  await expect(bar.getByRole('button', { name: 'Unmute microphone' })).toBeVisible()
  await expect(you).toHaveAttribute('data-participant-state', 'muted')
  await expect(you).toHaveAccessibleName(/muted/)
  // Muting is not leaving: the connection is untouched.
  await expect(status(page)).toHaveAttribute('data-voice-status', 'connected')

  await bar.getByRole('button', { name: 'Unmute microphone' }).click()
  await expect(bar.getByRole('button', { name: 'Mute microphone' })).toBeVisible()
  await expect(you).toHaveAttribute('data-participant-state', /speaking|listening/)
  await expect(status(page)).toHaveAttribute('data-voice-status', 'connected')

  await leaveVoice(page)
  await deleteChannel(page, name)
})

test('deafens and undeafens, locally, without leaving', async ({ page }, testInfo) => {
  const name = uniqueName('voicedeaf', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })
  await joinVoice(page, name)

  const bar = controls(page)
  const deafen = bar.getByRole('button', { name: 'Deafen' })
  await expect(deafen).toHaveAttribute('aria-pressed', 'false')

  await deafen.click()
  const undeafen = bar.getByRole('button', { name: 'Undeafen' })
  await expect(undeafen).toHaveAttribute('aria-pressed', 'true')
  // Deafen is about what you hear. It says nothing about your microphone and
  // nothing about the room.
  await expect(bar.getByRole('button', { name: 'Mute microphone' })).toBeVisible()
  await expect(status(page)).toHaveAttribute('data-voice-status', 'connected')

  await undeafen.click()
  await expect(bar.getByRole('button', { name: 'Deafen' })).toHaveAttribute('aria-pressed', 'false')
  await expect(status(page)).toHaveAttribute('data-voice-status', 'connected')

  await leaveVoice(page)
  await deleteChannel(page, name)
})

test('leaves the room when the page does', async ({ page }, testInfo) => {
  const name = uniqueName('voicenav', testInfo.project.name)
  await watchMicrophones(page)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })
  await joinVoice(page, name)
  await expect.poll(() => liveTracks(page), { timeout: 15_000 }).toBeGreaterThan(0)

  // Navigating away is not a way to keep a microphone open.
  await page.goto('/#/')
  await expect.poll(() => liveTracks(page), { timeout: 20_000 }).toBe(0)

  await deleteChannel(page, name)
})

test('says so plainly when it cannot connect, and offers another go', async ({
  page,
}, testInfo) => {
  const name = uniqueName('voicefail', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })

  // The token endpoint, unavailable. Nothing about the page should be.
  await page.route('**/functions/v1/voice-token', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Voice is not configured for this workspace' }),
    }),
  )

  await page.getByRole('button', { name: 'Join voice' }).click()
  await expect(status(page)).toHaveAttribute('data-voice-status', 'error', { timeout: 30_000 })
  await expect(page.getByRole('status')).toContainText(/not configured/i)

  // A failure is a thing to try again, not a dead end.
  const retry = page.getByRole('button', { name: 'Join voice' })
  await expect(retry).toBeEnabled()
  await expect(retry).toContainText('Try again')

  await page.unroute('**/functions/v1/voice-token')
  await joinVoice(page, name)

  await leaveVoice(page)
  await deleteChannel(page, name)
})

test('joins without a microphone when the browser refuses one', async ({ page }, testInfo) => {
  const name = uniqueName('voicemic', testInfo.project.name)

  // The browser saying no, exactly as it says it.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => {
      const error = new Error('Permission denied')
      error.name = 'NotAllowedError'
      return Promise.reject(error)
    }
  })

  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })

  await page.getByRole('button', { name: 'Join voice' }).click()

  // Connected anyway: being unable to speak is not being unable to listen.
  await expect(status(page)).toHaveAttribute('data-voice-status', 'connected', {
    timeout: 45_000,
  })
  await expect(page.getByRole('status')).toContainText(/microphone access is required/i)
  await expect(people(page, name).getByRole('listitem').first()).toHaveAttribute(
    'data-participant-state',
    'muted',
  )
  // And the way back is the same button it always was.
  await expect(controls(page).getByRole('button', { name: 'Unmute microphone' })).toBeVisible()

  await leaveVoice(page)
  await deleteChannel(page, name)
})

test('waits it out when the network goes, rather than giving up', async ({
  page,
  context,
}, testInfo) => {
  test.slow()
  const name = uniqueName('voicedrop', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })
  await joinVoice(page, name)

  await context.setOffline(true)
  // LiveKit's own recovery, reported rather than replaced. Nothing here
  // retries, and nothing asks the server for a second token.
  await expect(status(page)).toHaveAttribute('data-voice-status', 'reconnecting', {
    timeout: 60_000,
  })
  // The room stays on screen while it tries.
  await expect(page.getByRole('heading', { name })).toBeVisible()

  await context.setOffline(false)
  await expect(status(page)).toHaveAttribute('data-voice-status', /connected|idle/, {
    timeout: 60_000,
  })

  if ((await status(page).getAttribute('data-voice-status')) === 'connected') {
    await leaveVoice(page)
  }
  await deleteChannel(page, name)
})

test('holds a key to talk, and only where it should', async ({ page }, testInfo) => {
  const name = uniqueName('voiceptt', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })
  await joinVoice(page, name)

  const bar = controls(page)
  const you = people(page, name).getByRole('listitem').first()

  // Voice activity to begin with: nobody is surprised by a closed microphone.
  await expect(bar.getByRole('button', { name: 'Mute microphone' })).toBeVisible()

  await bar.getByRole('button', { name: 'Voice settings' }).click()
  await page.getByRole('menuitemradio', { name: /Push to talk/ }).click()
  await expect(page.getByRole('menu', { name: 'Voice settings' })).toHaveCount(0)

  // Turning it on closes the microphone rather than leaving it open.
  await expect(you).toHaveAttribute('data-participant-state', 'muted')
  await expect(bar.getByRole('button', { name: /Push to talk is on/ })).toBeDisabled()

  // Held: open. Released: closed. The room is not touched either way.
  await page.keyboard.down('Space')
  await expect(you).toHaveAttribute('data-participant-state', /speaking|listening/)
  await expect(status(page)).toHaveAttribute('data-voice-status', 'connected')

  await page.keyboard.up('Space')
  await expect(you).toHaveAttribute('data-participant-state', 'muted')
  await expect(status(page)).toHaveAttribute('data-voice-status', 'connected')

  // A window that loses focus mid-press must not leave it open. The listener
  // is what is being exercised here; a real alt-tab reaches it the same way.
  await page.keyboard.down('Space')
  await expect(you).toHaveAttribute('data-participant-state', /speaking|listening/)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
  })
  await expect(you).toHaveAttribute('data-participant-state', 'muted')
  await page.keyboard.up('Space')

  // Back to talking freely, and the microphone opens again.
  await bar.getByRole('button', { name: 'Voice settings' }).click()
  await page.getByRole('menuitemradio', { name: /Voice activity/ }).click()
  await expect(page.getByRole('menu', { name: 'Voice settings' })).toHaveCount(0)
  await expect(you).toHaveAttribute('data-participant-state', /speaking|listening/)
  await expect(bar.getByRole('button', { name: 'Mute microphone' })).toBeEnabled()

  await leaveVoice(page)

  // The listeners went with the room: a key pressed afterwards reaches
  // nothing and reconnects nothing.
  await page.keyboard.down('Space')
  await page.keyboard.up('Space')
  await expect(status(page)).toHaveAttribute('data-voice-status', 'idle')

  await deleteChannel(page, name)
})

test('remembers how you like to talk, and offers no microphone settings you cannot use', async ({
  page,
}, testInfo) => {
  const name = uniqueName('voiceset', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })
  await joinVoice(page, name)

  await controls(page).getByRole('button', { name: 'Voice settings' }).click()

  // The three the browser actually offers, and no invented fourth.
  const suppression = page.getByRole('switch', { name: /Noise suppression/ })
  await expect(suppression).toBeVisible()
  await expect(page.getByRole('switch', { name: /Echo cancellation/ })).toBeVisible()
  await expect(page.getByRole('switch', { name: /Automatic gain/ })).toBeVisible()
  await expect(page.getByText(/sensitivity|threshold/i)).toHaveCount(0)

  await expect(suppression).toBeChecked()
  await suppression.click()
  await expect(suppression).not.toBeChecked()
  // Replacing the microphone track is not leaving the room.
  await expect(status(page)).toHaveAttribute('data-voice-status', 'connected')
  await page.keyboard.press('Escape')

  // Kept across a reload, because it is a fact about this headset.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Join voice' })).toBeVisible({ timeout: 20_000 })
  await joinVoice(page, name)
  await controls(page).getByRole('button', { name: 'Voice settings' }).click()
  await expect(page.getByRole('switch', { name: /Noise suppression/ })).not.toBeChecked()

  // Put back, so the next run starts where this one did.
  await page.getByRole('switch', { name: /Noise suppression/ }).click()
  await page.keyboard.press('Escape')

  await leaveVoice(page)
  await deleteChannel(page, name)
})

test('offers no volume control for yourself', async ({ page }, testInfo) => {
  const name = uniqueName('voicevol', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })
  await joinVoice(page, name)

  // Turning your own playback down would silence nothing you can hear. The
  // control belongs to other people's rows, and there are none here — a
  // second participant needs a second account.
  const you = people(page, name).getByRole('listitem').first()
  await expect(you.getByRole('button', { name: /^Volume for / })).toHaveCount(0)

  await leaveVoice(page)
  await deleteChannel(page, name)
})

test('leaves text channels exactly as they were', async ({ page }, testInfo) => {
  const name = uniqueName('voicetext', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name)

  // The default is still text, and a text channel is still a chat.
  await expect(page.getByRole('textbox', { name: `Message ${name}` })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
  await expect(page.getByRole('group', { name: /^Voice in / })).toHaveCount(0)

  await openNav(page)
  await expect(
    page.getByRole('link', { name: new RegExp(name) }).getByLabel('Voice channel'),
  ).toHaveCount(0)
  await closeNav(page)

  await deleteChannel(page, name)
})

test('fits a narrow screen, connected and not', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'about the phone layout')

  const name = uniqueName('voicenarrow', testInfo.project.name)
  await page.goto('/#/')
  await createChannel(page, name, { kind: 'Voice' })

  const overflowing = () =>
    page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

  await expect(page.getByRole('button', { name: 'Join voice' })).toBeVisible({ timeout: 20_000 })
  expect(await overflowing()).toBe(false)

  await joinVoice(page, name)
  // Connected is the busier state: a list, a status chip and three controls.
  expect(await overflowing()).toBe(false)
  await expect(controls(page).getByRole('button', { name: 'Leave voice' })).toBeInViewport()

  await leaveVoice(page)
  await deleteChannel(page, name)
})
