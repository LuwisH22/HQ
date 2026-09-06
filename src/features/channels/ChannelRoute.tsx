import { Suspense, lazy } from 'react'
import { useParams } from 'react-router-dom'
import { CardSkeleton } from '@/components/common/states'
import { useChannelByKey } from './use-channels'
import { ChannelChatPage } from './ChannelChatPage'

/**
 * Loaded only when a voice channel is actually opened.
 *
 * The WebRTC client is around half a megabyte. Bundled here it would ride
 * along with every text channel anybody opens, to do nothing at all.
 */
const VoiceChannelPage = lazy(() =>
  import('@/features/voice/VoiceChannelPage').then((m) => ({ default: m.VoiceChannelPage })),
)

/**
 * One address, two kinds of room.
 *
 * `/channels/:key` is where a channel lives whatever it is for, so the type
 * decides the surface rather than the URL. Until the directory has loaded
 * there is no type to read, and the text page's own skeleton is the honest
 * thing to show — it is what a channel looked like a moment ago and what it
 * will be nine times out of ten.
 */
export function ChannelRoute() {
  const { channelKey } = useParams<{ channelKey: string }>()
  const { channel } = useChannelByKey(channelKey)

  if (channel?.type === 'voice') {
    return (
      <Suspense
        fallback={
          <div className="p-4 sm:p-6">
            <CardSkeleton lines={4} />
          </div>
        }
      >
        <VoiceChannelPage channel={channel} />
      </Suspense>
    )
  }
  return <ChannelChatPage />
}
