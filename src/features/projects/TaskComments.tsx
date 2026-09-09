import { useEffect, useRef, useState } from 'react'
import { DotsThree, PaperPlaneRight } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { TaskComment } from '@/services/comment.service'
import { formatTimestamp } from '@/utils/datetime'
import { cn } from '@/lib/utils'
import { isEditable, isSendable } from './comment-body'
import { useCommentMutations, useComments } from './use-comments'

/**
 * What people have said about a task.
 *
 * Rows rather than bubbles: this is a conversation attached to a piece of
 * work, not a chat room, and the typography follows the message list — Geist
 * for the words, mono for the metadata, a hairline between one and the next.
 *
 * Bodies are rendered as text, never as markup. There is no HTML string here
 * for anything to be injected into.
 */
export function TaskComments({
  organizationId,
  taskId,
  currentUserId,
  canModerate,
  canWrite,
}: {
  organizationId: string | undefined
  taskId: string
  currentUserId: string | null
  /** `tasks.manage`: may edit or remove somebody else's words. */
  canModerate: boolean
  /** False on an archived project, where the database refuses anyway. */
  canWrite: boolean
}) {
  const { query, comments, hasMore, loadOlder, loadingOlder, reset } = useComments(
    organizationId,
    taskId,
  )
  const mutations = useCommentMutations(organizationId, taskId)
  const [editing, setEditing] = useState<string | null>(null)

  // A different task is a different conversation; the paged tail goes with it.
  useEffect(() => {
    reset()
    setEditing(null)
    // `reset` is stable enough for this: it only ever clears local paging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  return (
    <section aria-labelledby="task-comments" className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 id="task-comments" className="display-eyebrow text-3xs text-muted-foreground">
          Comments
        </h3>
        <span className="text-3xs text-muted-foreground/60 font-mono">{comments.length}</span>
      </div>

      {hasMore ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-2xs h-6"
          loading={loadingOlder}
          onClick={() => {
            void loadOlder()
          }}
        >
          Earlier comments
        </Button>
      ) : null}

      {query.isPending ? (
        <p className="text-muted-foreground/70 text-xs">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-muted-foreground/70 text-xs">Nothing said yet.</p>
      ) : null}

      <ul className="divide-border-subtle divide-y">
        {comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            mine={comment.authorId !== null && comment.authorId === currentUserId}
            canModerate={canModerate}
            canWrite={canWrite}
            editing={editing === comment.id}
            onEdit={() => {
              setEditing(comment.id)
            }}
            onCancel={() => {
              setEditing(null)
            }}
            onSave={(body) => {
              mutations.update.mutate(
                { commentId: comment.id, body },
                {
                  onSuccess: () => {
                    setEditing(null)
                  },
                },
              )
            }}
            onDelete={() => {
              mutations.remove.mutate(comment.id)
            }}
            saving={mutations.update.isPending}
          />
        ))}
      </ul>

      {canWrite ? (
        <Composer
          busy={mutations.create.isPending}
          onSend={(body) => {
            mutations.create.mutate(body)
          }}
        />
      ) : null}
    </section>
  )
}

/**
 * One comment.
 *
 * A deleted one keeps its place and its author and loses its words — the
 * database emptied them, and there is nothing in this component that could
 * show them even if somebody wanted it to. Said neutrally: a deletion is
 * ordinary, not an incident.
 */
function CommentRow({
  comment,
  mine,
  canModerate,
  canWrite,
  editing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  saving,
}: {
  comment: TaskComment
  mine: boolean
  canModerate: boolean
  canWrite: boolean
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (body: string) => void
  onDelete: () => void
  saving: boolean
}) {
  const [draft, setDraft] = useState(comment.body)
  const mayChange = canWrite && (mine || canModerate)
  const deleted = comment.deletedAt !== null

  useEffect(() => {
    if (editing) setDraft(comment.body)
  }, [comment.body, editing])

  return (
    <li className="group flex gap-2.5 py-2.5">
      <Avatar className="mt-0.5 size-6 shrink-0">
        <AvatarImage src={comment.authorAvatarUrl ?? undefined} alt="" />
        <AvatarFallback className="text-[9px]">
          {comment.authorName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate text-xs font-medium">{comment.authorName}</span>
          <span className="text-3xs text-muted-foreground/70 font-mono">
            {formatTimestamp(comment.createdAt)}
            {!deleted && comment.updatedAt !== comment.createdAt ? ' · edited' : ''}
          </span>
        </p>

        {deleted ? (
          <p className="text-muted-foreground/60 mt-1 text-xs italic">Comment deleted</p>
        ) : editing ? (
          <div className="mt-1.5 space-y-1.5">
            <Textarea
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
              }}
              rows={2}
              maxLength={4000}
              aria-label="Edit comment"
              className="resize-y text-xs"
            />
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" className="text-2xs h-6" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-2xs h-6"
                loading={saving}
                disabled={!isEditable(draft, comment.body)}
                onClick={() => {
                  onSave(draft)
                }}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          // Text, as text. No markup is built from it anywhere.
          <p className="text-secondary-foreground mt-0.5 text-xs break-words whitespace-pre-wrap">
            {comment.body}
          </p>
        )}
      </div>

      {mayChange && !deleted && !editing ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${comment.authorName}'s comment`}
              className={cn(
                'text-muted-foreground/50 hover:text-foreground size-6 shrink-0',
                'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
              )}
            >
              <DotsThree className="size-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {mine ? <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem> : null}
            <DropdownMenuItem onSelect={onDelete}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  )
}

/** The box at the bottom. Enter sends; shift and enter make a new line. */
function Composer({ busy, onSend }: { busy: boolean; onSend: (body: string) => void }) {
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)

  const send = () => {
    if (!isSendable(draft) || busy) return
    onSend(draft.trim())
    setDraft('')
    box.current?.focus()
  }

  return (
    <form
      className="flex items-end gap-2 pt-1"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <Textarea
        ref={box}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send()
          }
        }}
        rows={1}
        maxLength={4000}
        placeholder="Write a comment"
        aria-label="Write a comment"
        className="min-h-8 resize-y py-1.5 text-xs"
      />
      <Button
        type="submit"
        size="icon-sm"
        aria-label="Send comment"
        loading={busy}
        disabled={!isSendable(draft)}
      >
        <PaperPlaneRight className="size-3.5" aria-hidden="true" />
      </Button>
    </form>
  )
}
