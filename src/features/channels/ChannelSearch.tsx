import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CardSkeleton, EmptyState, ErrorState } from '@/components/common/states'
import { messageService } from '@/services/message.service'
import { queryKeys } from '@/lib/query-keys'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cn } from '@/lib/utils'

/**
 * Searching a channel, or every channel you can see.
 *
 * The routine behind this is SECURITY INVOKER, so the messages policy has
 * already decided what may come back before this component sees anything.
 * There is no filtering here — which is the point: a result set that arrives
 * pre-scoped cannot be widened by a mistake in the interface.
 */
export function ChannelSearch({
  channelId,
  channelName,
  onClose,
}: {
  channelId: string
  channelName: string
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [everywhere, setEverywhere] = useState(false)
  const debounced = useDebouncedValue(query.trim(), 250)

  const scope = everywhere ? null : channelId

  const results = useQuery({
    queryKey: queryKeys.messages.search(scope, debounced),
    queryFn: () => messageService.search({ query: debounced, channelId: scope }),
    enabled: debounced.length > 1,
  })

  return (
    <div className="border-border bg-background flex h-full min-h-0 flex-col border-b">
      <div className="flex items-center gap-2 px-4 py-2.5 sm:px-6">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlass
            className="text-muted-foreground/70 pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={everywhere ? 'Search every channel' : `Search #${channelName}`}
            aria-label="Search messages"
            className="pl-8"
            autoFocus
          />
        </div>

        <Button
          type="button"
          size="sm"
          variant={everywhere ? 'default' : 'outline'}
          aria-pressed={everywhere}
          onClick={() => setEverywhere((value) => !value)}
        >
          All channels
        </Button>

        <Button size="icon-sm" variant="ghost" aria-label="Close search" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
        {debounced.length <= 1 ? (
          <p className="text-muted-foreground text-2xs px-1 py-2 leading-relaxed">
            Type at least two characters. Only channels you can see are searched.
          </p>
        ) : results.isPending ? (
          <CardSkeleton lines={4} />
        ) : results.isError ? (
          <ErrorState error={results.error} onRetry={() => void results.refetch()} />
        ) : (results.data ?? []).length === 0 ? (
          <EmptyState
            icon={MagnifyingGlass}
            title="Nothing matches that"
            description="Try a different word, or search every channel."
            className="border-0"
          />
        ) : (
          <ul className="space-y-1" aria-label="Search results">
            {(results.data ?? []).map((result) => (
              <li key={result.id}>
                <Link
                  to={`/channels/${result.channelKey}`}
                  onClick={onClose}
                  className={cn(
                    'hover:bg-elevated block rounded-md px-2 py-2 transition-colors duration-[140ms]',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                  )}
                >
                  <p className="text-3xs text-muted-foreground flex items-center gap-1.5">
                    <span className="font-medium">#{result.channelName}</span>
                    {result.parentMessageId ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-accent-text">in a thread</span>
                      </>
                    ) : null}
                    <span aria-hidden="true">·</span>
                    <span>{result.authorName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{new Date(result.createdAt).toLocaleDateString()}</span>
                  </p>
                  <p className="text-foreground/92 mt-0.5 text-xs leading-relaxed break-words">
                    {result.body}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
