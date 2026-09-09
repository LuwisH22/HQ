import { DotsSixVertical } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { Task } from '@/services/task.service'
import type { ProjectMember } from '@/services/project.service'
import type { Label } from '@/services/label.service'
import { displayNameFor, initialsFor } from '@/services/profile.service'
import { formatDate } from '@/utils/datetime'
import { cn } from '@/lib/utils'
import { TASK_PRIORITY_LABELS, TASK_PRIORITY_TONE } from './task-status'
import { LABEL_DOT_TONE } from './label-colors'

/**
 * One task, small enough that a column of them reads as a list.
 *
 * The card body is a button that opens the task; the grip beside it is what
 * drags. Two targets rather than one, so a tap is never ambiguous and a
 * finger on a phone can still scroll the board by touching the card.
 *
 * Priority is a word in the label and a mark on the edge — never the mark
 * alone, which would leave the whole signal in a colour.
 */
export function TaskCard({
  task,
  assignee,
  labels,
  onOpen,
  onGrabPointer,
  onGrabKeyboard,
  cardRef,
  dragging = false,
  canMove,
}: {
  task: Task
  assignee: ProjectMember | undefined
  /** The labels on this task, resolved from the project's own list. */
  labels: Label[]
  onOpen: () => void
  onGrabPointer: (event: React.PointerEvent) => void
  onGrabKeyboard: () => void
  cardRef?: (element: HTMLElement | null) => void
  /** True for the card being carried, which is drawn as a hole. */
  dragging?: boolean
  canMove: boolean
}) {
  const due = task.dueDate ? formatDate(task.dueDate) : null

  return (
    <li
      ref={cardRef}
      data-task-id={task.id}
      className={cn(
        'border-border-subtle bg-surface relative flex items-stretch gap-1 rounded-md border',
        'transition-colors duration-[120ms]',
        dragging ? 'opacity-30' : 'hover:border-border-strong',
      )}
    >
      {/* The mark, and the word for it in the button's own label. */}
      {task.priority === 'none' ? null : (
        <span
          className={cn(
            'absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full',
            TASK_PRIORITY_TONE[task.priority],
          )}
          aria-hidden="true"
        />
      )}

      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'min-w-0 flex-1 rounded-md px-2.5 py-2 text-left',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        )}
      >
        {/*
          Two lines, not one.
          A card is the one place a title has room to be read, and a column
          this narrow cuts most of them off at a word or two — "Confirm scrim
          partners f…" tells a reader nothing they did not already know from
          the column it is in. Two lines is enough for almost every task
          anybody writes, and the ones longer than that still end honestly in
          an ellipsis rather than being clipped mid-descender.
        */}
        <span className="line-clamp-2 text-xs leading-snug font-medium break-words">
          {task.title}
        </span>

        {labels.length > 0 ? (
          // A mark and a name, small: the card says what it is labelled
          // without becoming a row of coloured pills.
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {labels.map((label) => (
              <span
                key={label.id}
                className="text-3xs text-muted-foreground inline-flex items-center gap-1"
              >
                <span
                  className={cn('size-1.5 rounded-full', LABEL_DOT_TONE[label.color])}
                  aria-hidden="true"
                />
                {label.name}
              </span>
            ))}
          </span>
        ) : null}

        <span className="text-3xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono">
          {task.priority === 'none' ? null : <span>{TASK_PRIORITY_LABELS[task.priority]}</span>}
          {due ? <span>{due}</span> : null}
          {assignee ? (
            <span className="inline-flex items-center gap-1">
              <Avatar className="size-3.5">
                <AvatarImage src={assignee.profile.avatarUrl ?? undefined} alt="" />
                <AvatarFallback className="text-[7px]">
                  {initialsFor(assignee.profile)}
                </AvatarFallback>
              </Avatar>
              {displayNameFor(assignee.profile)}
            </span>
          ) : null}
        </span>
      </button>

      {canMove ? (
        <button
          type="button"
          // Only the grip stops the browser scrolling, so a finger anywhere
          // else on the board still pans it.
          style={{ touchAction: 'none' }}
          aria-label={`Reorder ${task.title}`}
          onPointerDown={onGrabPointer}
          onKeyDown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return
            event.preventDefault()

            // While this card is the one being carried, the same key means
            // "put it down" — and the thing listening for that is the window,
            // because a card being carried moves between columns and focus
            // cannot chase it. So the event is left alone to get there.
            if (dragging) return

            // Picking up, on the other hand, must not also reach the window.
            // React flushes the effect that starts that listener during this
            // very keypress, and the event then carries on bubbling into the
            // listener it just created — so without this the card is picked up
            // and dropped again by one press, which is what a keyboard user
            // was getting.
            event.stopPropagation()
            onGrabKeyboard()
          }}
          className={cn(
            'text-muted-foreground/40 hover:text-muted-foreground flex w-5 shrink-0 items-center justify-center',
            'cursor-grab rounded-r-md transition-colors active:cursor-grabbing',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          )}
        >
          <DotsSixVertical className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  )
}
