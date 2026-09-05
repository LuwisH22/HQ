import { ChatTeardropText, Microphone, MonitorPlay, PushPin } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { initialsFor } from '@/services/profile.service'
import type { Conversation } from '@/services/conversation.service'
import type { Message } from '@/services/message.service'

/**
 * What a conversation is, who is in it, and what is pinned in it.
 *
 * The channel panel's sibling rather than a rewrite of it: the same sections
 * in the same order, minus the ones a conversation has no answer for. There is
 * no topic, because nobody sets one; there is no privacy note, because every
 * conversation is private; and the member list is the two people in it, which
 * is also the whole of its authorization.
 */

function SectionHeading({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-baseline gap-2 px-4 pt-5 pb-2">
      <h2 className="text-3xs text-foreground/42 font-semibold tracking-[0.1em] uppercase">
        {label}
      </h2>
      {count === undefined ? null : (
        <span className="text-3xs text-foreground/30 tabular-nums">{count}</span>
      )}
    </div>
  )
}

function ActivityRow({
  icon: Icon,
  label,
  detail,
}: {
  icon: typeof Microphone
  label: string
  detail: string
}) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-1.5">
      <Icon className="text-muted-foreground/60 mt-px size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs leading-tight font-medium">{label}</p>
        <p className="text-2xs text-muted-foreground/70 mt-0.5 leading-relaxed">{detail}</p>
      </div>
    </div>
  )
}

export function ConversationPanelContent({
  conversation,
  pinned,
  pinnedPending,
}: {
  conversation: Conversation
  pinned: Message[]
  pinnedPending: boolean
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <SectionHeading label="Conversation" />
      <div className="px-4">
        <p className="flex items-center gap-1.5 text-sm leading-tight font-semibold">
          <ChatTeardropText
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span className="truncate">{conversation.otherName}</span>
        </p>
        <p className="text-2xs text-muted-foreground mt-1 leading-relaxed">
          Only the two of you can see this. Nobody else in the organization can, whatever they hold.
        </p>
      </div>

      <SectionHeading label="Pinned" count={pinnedPending ? undefined : pinned.length} />
      {pinnedPending ? (
        <div className="space-y-2 px-4 py-1" aria-hidden="true">
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      ) : pinned.length === 0 ? (
        <p className="text-muted-foreground/70 text-2xs px-4 leading-relaxed">
          Nothing pinned yet.
        </p>
      ) : (
        <ul aria-label="Pinned messages" className="px-2">
          {pinned.map((message) => (
            <li key={message.id} className="flex items-start gap-2 rounded-md px-2 py-1.5">
              <PushPin className="text-accent-text mt-px size-3.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs leading-relaxed break-words">{message.body}</p>
                <p className="text-2xs text-muted-foreground/70 truncate">{message.authorName}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionHeading label="Members" count={2} />
      <ul aria-label="Conversation members" className="px-2">
        <li className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <Avatar className="size-7 shrink-0">
            {conversation.otherAvatarUrl ? (
              <AvatarImage src={conversation.otherAvatarUrl} alt="" />
            ) : null}
            <AvatarFallback>{initialsFor({ displayName: conversation.otherName })}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs leading-tight font-medium">{conversation.otherName}</p>
            <p className="text-2xs text-muted-foreground truncate">Direct message</p>
          </div>
        </li>
      </ul>

      <SectionHeading label="Activity" />
      <div className="pb-4">
        <ActivityRow icon={Microphone} label="Voice" detail="No active voice session." />
        <ActivityRow icon={MonitorPlay} label="Streaming" detail="No active stream." />
      </div>
    </div>
  )
}
