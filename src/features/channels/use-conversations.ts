import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { conversationService, type Conversation } from '@/services/conversation.service'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'

/**
 * The conversations the signed-in member is in.
 *
 * Nothing here decides access. The list arrives already scoped by RLS through
 * `can_in_conversation`, so a conversation the member is not in is absent
 * rather than hidden — including from the organization's owner, who has no
 * bypass inside a direct message and is not meant to.
 */
export function useConversations(): UseQueryResult<Conversation[]> {
  const { organization } = useWorkspace()
  const organizationId = organization?.id

  return useQuery({
    queryKey: queryKeys.conversations.all(organizationId ?? 'none'),
    queryFn: () => conversationService.list(organizationId as string),
    enabled: Boolean(organizationId),
  })
}

/** One conversation, from the same list, so the two cannot disagree. */
export function useConversation(conversationId: string | undefined): {
  conversation: Conversation | null
  query: UseQueryResult<Conversation[]>
} {
  const query = useConversations()
  const conversation = conversationId
    ? (query.data?.find((c) => c.id === conversationId) ?? null)
    : null

  return { conversation, query }
}
