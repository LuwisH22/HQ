/**
 * Where a voice room is actually heard.
 *
 * This is the step that was missing, and it is worth being explicit about why
 * it exists at all: subscribing to a remote track gets the bytes, and does not
 * make a sound. WebRTC hands you a `MediaStreamTrack`; something has to attach
 * it to a media element, and that element has to be in the document, or the
 * audio arrives and is thrown away. LiveKit's `track.attach()` builds the
 * element and starts it — but only if somebody calls it.
 *
 * One hidden container holds one `<audio>` per remote track. It lives outside
 * React for the same reason the Room does: a page that unmounts must not take
 * the sound with it.
 *
 * Deliberately typed against the shape it uses rather than against
 * `RemoteAudioTrack`, so the whole path can be exercised without a media
 * server — and so this module stays out of the WebRTC chunk.
 */

/** As much of a LiveKit audio track as playing one requires. */
export interface PlayableAudioTrack {
  attach(): HTMLMediaElement
  detach(): HTMLMediaElement[]
  setVolume(volume: number): void
  readonly attachedElements: HTMLMediaElement[]
}

let sink: HTMLElement | null = null

/** The container, created the first time there is something to put in it. */
export function audioSink(): HTMLElement {
  if (sink?.isConnected) return sink

  const element = document.createElement('div')
  element.dataset.voiceAudio = 'sink'
  // Present but invisible: an audio element has to be in the document to
  // play, and there is nothing here to look at.
  element.style.display = 'none'
  document.body.append(element)
  sink = element
  return element
}

/**
 * Give a track an element to come out of, at this listener's volume.
 *
 * The volume is applied after the attach, never before: `setVolume` writes the
 * volume of the elements a track is attached to, so on a track with none it is
 * a call that does nothing.
 */
export function playRemoteAudio(
  track: PlayableAudioTrack,
  identity: string,
  volume: number,
): HTMLMediaElement {
  const element = track.attach()
  element.dataset.voiceIdentity = identity
  audioSink().append(element)
  track.setVolume(volume)
  return element
}

/** Take the elements away, and the sound with them. */
export function stopRemoteAudio(track: PlayableAudioTrack): void {
  for (const element of track.detach()) element.remove()
}

/** Whether this track is already coming out of something. */
export function isPlaying(track: PlayableAudioTrack): boolean {
  return track.attachedElements.length > 0
}

/** Every element this session made, gone. */
export function clearAudioSink(): void {
  if (!sink) return
  sink.remove()
  sink = null
}

/** How many elements are playing right now. For tests and for diagnosis. */
export function playingCount(): number {
  return sink?.querySelectorAll('audio, video').length ?? 0
}
