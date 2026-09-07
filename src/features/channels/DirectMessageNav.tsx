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

/**
 * What to call the person on the other side.
 *
 * A conversation is named by whoever is in it, and that name falls back
 * through display name, full name and finally the address they signed up
 * with. An address is not a name: in a 240px column it is the longest thing
 * on screen and the least readable, so the sidebar shows the part before the
 * @ and leaves the whole of it to the screen reader and to the conversation's
 * own header.
 */
function labelFor(name: string): string {
  const at = name.indexOf('@')
  return at > 0 ? name.slice(0, at) : name
}

function ConversationRow({
  conversation,
  onNavigate,
}: {
  conversation: Conversation
  onNavigate?: () => void
}) {
  const unread = conversation.unread
  const label = labelFor(conversation.otherName)

  return (
    <NavLink
      to={`/dm/${conversation.id}`}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex h-[30px] items-center gap-2 rounded-sm px-2 text-sm transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
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
              what makes the row read as one. Hidden from the accessible name:
              read aloud, the initials are the name again with the letters
              removed — the row announced "AGAGER". */}
          <Avatar className="size-5 shrink-0 rounded-sm" aria-hidden="true">
            {conversation.otherAvatarUrl ? (
              <AvatarImage src={conversation.otherAvatarUrl} alt="" />
            ) : null}
            <AvatarFallback className="rounded-sm text-[9px]">
              {initialsFor({ displayName: conversation.otherName })}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{label}</span>
          {/* The whole address, for anyone who cannot see the row: two people
              can share a local part, and the sidebar's shortening must not
              make them the same person to a screen reader. */}
          {label === conversation.otherName ? null : (
            <span className="sr-only">{conversation.otherName}</span>
          )}
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
      <div className="mt-5 mb-2 flex h-5 items-center gap-1 px-2">
        <p className="display-eyebrow text-3xs text-muted-foreground flex-1">Direct messages</p>
        <StartDirectMessage onNavigate={onNavigate} />
      </div>

      {query.isPending ? (
        <div className="space-y-1 px-1" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="bg-muted h-6 rounded-sm" />
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
