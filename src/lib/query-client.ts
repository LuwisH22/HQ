import { QueryCache, QueryClient, MutationCache } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AppError, toAppError } from './errors'

/**
 * Query defaults tuned for a ~6-person private workspace on the free tier:
 * generous cache lifetimes, no refetch storms, and no retrying of errors that
 * retrying cannot fix.
 */
const ONE_MINUTE = 60_000

function shouldRetry(failureCount: number, error: unknown): boolean {
  const appError = error instanceof AppError ? error : toAppError(error)
  // Permission and validation failures are deterministic — hammering the
  // server with them just burns quota and delays the error state.
  if (!appError.retryable) return false
  return failureCount < 2
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * ONE_MINUTE,
        gcTime: 15 * ONE_MINUTE,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        // The desktop window is long-lived; refetching on every focus would
        // mean a burst of requests every time the user alt-tabs back.
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        refetchOnMount: true,
      },
      mutations: {
        retry: false,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Only surface background-refresh failures when there is already data
        // on screen; a first load renders its own error state instead.
        if (query.state.data === undefined) return
        toast.error(toAppError(error).userMessage)
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        // A mutation with its own onError owns the messaging.
        if (mutation.options.onError) return
        toast.error(toAppError(error).userMessage)
      },
    }),
  })
}
