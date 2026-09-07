import { NavLink } from 'react-router-dom'
import { ChatTeardropText } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initialsFor } from '@/services/profile.service'
import type { Conversation } from '@/services/conversation.service'
import { cn } from '@/lib/utils'
import { useConversations } from './use-conversations'
import { StartDirectMessage } from './StartDirectMessage'

/**
 * The direct messages section of the sidebar.
 *
 * Its own section, next to the channels rather than inside one: a conversation
 * is not a room the organization owns, and putting it in a category would say
 * it was. The list arrives already scoped by RLS, so what is drawn here is
 * exactly what the member is in.
 *
 * A 1-to-1 is named by the person on the other side of it, which is the only
 * name it has.
 */

function ConversationRow({
  conversation,
  onNavigate,
}: {
  conversation: Conversation
  onNavigate?: () => void
}) {
  const unread = conversation.unread

  return (
    <NavLink
      to={`/dm/${conversation.id}`}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex h-[30px] items-center gap-2 rounded-sm px-2 text-sm transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          isActive
            ? 'bg-surface-active text-foreground font-medium'
            : unread > 0
              ? 'text-foreground hover:bg-accent font-semibold'
              : 'text-secondary-foreground hover:bg-accent hover:text-foreground font-medium',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? <span aria-hidden="true" className="nav-rail -left-1.5" /> : null}
          {/* A tile rather than a glyph: these are people, and a 20px tile is
              what makes the row read as one. */}
          <Avatar className="size-5 shrink-0 rounded-xs">
            {conversation.otherAvatarUrl ? (
              <AvatarImage src={conversation.otherAvatarUrl} alt="" />
            ) : null}
            <AvatarFallback className="rounded-xs text-[8px]">
              {initialsFor({ displayName: conversation.otherName })}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{conversation.otherName}</span>
          {unread > 0 ? (
            <span
              className="text-2xs text-foreground ml-auto font-mono tabular-nums"
              aria-label={`${String(unread)} unread`}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  )
}

export function DirectMessageNav({ onNavigate }: { onNavigate?: () => void }) {
  const query = useConversations()
  const conversations = query.data ?? []

  return (
    <>
      <div className="flex h-6 items-center gap-1 px-2 pt-4">
        <p className="display-eyebrow text-3xs text-muted-foreground flex-1">Direct messages</p>
        <StartDirectMessage onNavigate={onNavigate} />
      </div>

      {query.isPending ? (
        <div className="space-y-1 px-1" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="bg-foreground/7 h-6 rounded-sm" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-destructive-text text-2xs px-1 leading-relaxed">
          Could not load your conversations.
        </p>
      ) : conversations.length === 0 ? (
        <p className="text-muted-foreground/70 text-2xs flex items-center gap-2 px-1 leading-relaxed">
          <ChatTeardropText className="size-3.5 shrink-0" aria-hidden="true" />
          No conversations yet. Use + to start one.
        </p>
      ) : (
        <ul className="space-y-px" aria-label="Direct messages">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <ConversationRow conversation={conversation} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
