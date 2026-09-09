import { useState } from 'react'
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
import type { ProjectReviewComment } from '@/services/review-comment.service'
import { formatTimestamp } from '@/utils/datetime'
import { cn } from '@/lib/utils'
import { COMMENT_MAX_LENGTH, isEditable, isSendable } from './comment-body'
import { useReviewCommentMutations, useReviewComments } from './use-review-comments'

/**
 * What people said while reviewing the project.
 *
 * About the project as a whole, which is why it is not on a task and not in
 * `task_comments`: a remark like "the edit is too long" belongs to the
 * project, and hanging it off whichever task happened to be open would make it
 * unfindable later.
 *
 * Rounds are kept. Asking for changes ends a round and starts the next one,
 * and nothing is deleted when it does — a reviewer on round three can read
 * what was said on round one, with a rule between them saying which was which.
 *
 * Bodies are rendered as text, never as markup. There is no HTML string here
 * for anything to be injected into.
 */
export function ProjectReviewPanel({
  organizationId,
  projectId,
  currentUserId,
  canModerate,
  canWrite,
}: {
  organizationId: string | undefined
  projectId: string
  currentUserId: string | null
  /** `projects.manage`: may edit or remove somebody else's words. */
  canModerate: boolean
  /** False on an archived project, where the database refuses anyway. */
  canWrite: boolean
}) {
  const query = useReviewComments(organizationId, projectId)
  const mutations = useReviewCommentMutations(organizationId, projectId)
  const [editing, setEditing] = useState<string | null>(null)

  const comments = query.data ?? []

  return (
    <section aria-labelledby="project-review" className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 id="project-review" className="display-eyebrow text-3xs text-muted-foreground">
          Review
        </h2>
        <span className="text-3xs text-muted-foreground/60 font-mono">{comments.length}</span>
      </div>

      {query.isPending ? (
        <p className="text-muted-foreground/70 text-xs">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-muted-foreground/70 text-xs">Nothing said yet.</p>
      ) : null}

      <ul className="divide-border-subtle divide-y">
        {comments.map((comment, index) => (
          <ReviewRow
            key={comment.id}
            comment={comment}
            // A rule and a number where the round changes, so a conversation
            // that has been round twice reads as two conversations.
            startsRound={index === 0 || comments[index - 1]?.reviewRound !== comment.reviewRound}
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
 * One remark.
 *
 * A deleted one keeps its place, its author and its round, and loses its
 * words — the database emptied them, and there is nothing in this component
 * that could show them even if somebody wanted it to.
 */
function ReviewRow({
  comment,
  startsRound,
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
  comment: ProjectReviewComment
  startsRound: boolean
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
  const deleted = comment.deletedAt !== null
  const mayChange = canWrite && !deleted && (mine || canModerate)
  const initials = comment.authorName.slice(0, 2).toUpperCase()

  return (
    <li className="py-2.5 first:pt-0">
      {startsRound ? (
        <p className="display-eyebrow text-3xs text-muted-foreground/60 mb-2">
          {comment.reviewRound === 0 ? 'Before review' : `Round ${String(comment.reviewRound)}`}
        </p>
      ) : null}

      <div className="flex gap-2.5">
        <Avatar className="mt-0.5 size-6 shrink-0">
          <AvatarImage src={comment.authorAvatarUrl ?? undefined} alt="" />
          <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2">
            <span className="text-xs font-medium">{comment.authorName}</span>
            <span className="text-3xs text-muted-foreground/60 font-mono">
              {formatTimestamp(comment.createdAt)}
            </span>
            {comment.updatedAt !== comment.createdAt && !deleted ? (
              <span className="text-3xs text-muted-foreground/60">edited</span>
            ) : null}
          </p>

          {editing ? (
            <div className="mt-1.5 space-y-2">
              <Textarea
                aria-label="Edit comment"
                value={draft}
                maxLength={COMMENT_MAX_LENGTH}
                onChange={(event) => {
                  setDraft(event.target.value)
                }}
                className="min-h-16 text-xs"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" className="text-2xs h-6" onClick={onCancel}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="text-2xs h-6"
                  loading={saving}
                  disabled={!isEditable(draft, comment.body)}
                  onClick={() => {
                    onSave(draft.trim())
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <p
              className={cn(
                'mt-0.5 text-xs leading-relaxed break-words whitespace-pre-wrap',
                deleted ? 'text-muted-foreground/60 italic' : '',
              )}
            >
              {deleted ? 'This comment was deleted.' : comment.body}
            </p>
          )}
        </div>

        {mayChange && !editing ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground/40 hover:text-muted-foreground size-6 shrink-0"
                aria-label={`Actions for ${comment.authorName}’s comment`}
              >
                <DotsThree aria-hidden="true" weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {mine ? (
                <DropdownMenuItem
                  onSelect={() => {
                    setDraft(comment.body)
                    onEdit()
                  }}
                >
                  Edit
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem destructive onSelect={onDelete}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  )
}

/** Somewhere to say something. Enter sends; shift-enter is a new line. */
function Composer({ busy, onSend }: { busy: boolean; onSend: (body: string) => void }) {
  const [draft, setDraft] = useState('')

  const send = () => {
    if (!isSendable(draft)) return
    onSend(draft.trim())
    setDraft('')
  }

  return (
    <div className="flex items-end gap-2">
      <Textarea
        aria-label="Write a review comment"
        placeholder="Say something about this project…"
        value={draft}
        maxLength={COMMENT_MAX_LENGTH}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send()
          }
        }}
        className="min-h-9 flex-1 text-xs"
      />
      <Button
        size="icon"
        aria-label="Send comment"
        loading={busy}
        disabled={!isSendable(draft)}
        onClick={send}
      >
        <PaperPlaneRight aria-hidden="true" weight="fill" />
      </Button>
    </div>
  )
}
