import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowCounterClockwise, CheckCircle, Play, PaperPlaneTilt } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import type { Project } from '@/services/project.service'
import { ReviewCountdown } from './ReviewCountdown'
import { useDeadlinePassed } from './use-review-deadline'
import { SendToReviewDialog } from './SendToReviewDialog'
import { CompleteProjectDialog } from './CompleteProjectDialog'
import type { useProjectLifecycle } from './use-projects'

/**
 * The one thing to do with a project next.
 *
 * A named action per stage rather than a dropdown of every stage, which is the
 * whole difference between a workflow and a label. Each button corresponds to
 * exactly one move the database allows from where the project currently is, so
 * there is never a control on screen whose only possible outcome is a refusal.
 *
 * Nothing here decides anything. `transition_project` re-checks the stage, the
 * permission, the archive, the deadline and the open work; these buttons decide
 * what to offer, and if the two ever disagree the routine wins and says so.
 */
export function ProjectWorkflow({
  project,
  lifecycle,
  canManage,
  unfinished,
}: {
  project: Project
  lifecycle: ReturnType<typeof useProjectLifecycle>
  /** `projects.manage`. Without it the stage is shown and nothing is offered. */
  canManage: boolean
  unfinished: number
}) {
  const [sending, setSending] = useState(false)
  const [completing, setCompleting] = useState(false)
  const reviewOver = useDeadlinePassed(project.reviewDeadlineAt)
  const { move } = lifecycle

  // An archived project is out of the workflow entirely: it keeps its stage
  // and takes no moves until it is restored, which the header offers.
  if (project.archivedAt !== null) return null

  if (project.status === 'planned') {
    return canManage ? (
      <Button
        loading={move.isPending}
        onClick={() => {
          move.mutate(
            { target: 'in_progress' },
            {
              onSuccess: () => {
                toast.success('Project started.')
              },
            },
          )
        }}
      >
        <Play aria-hidden="true" weight="fill" />
        Start project
      </Button>
    ) : null
  }

  if (project.status === 'in_progress') {
    return canManage ? (
      <>
        <Button
          onClick={() => {
            setSending(true)
          }}
        >
          <PaperPlaneTilt aria-hidden="true" />
          Send to review
        </Button>
        <SendToReviewDialog open={sending} onOpenChange={setSending} lifecycle={lifecycle} />
      </>
    ) : null
  }

  if (project.status === 'in_review') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ReviewCountdown deadline={project.reviewDeadlineAt} />

        {canManage ? (
          <>
            <Button
              variant="secondary"
              loading={move.isPending}
              onClick={() => {
                move.mutate(
                  { target: 'in_progress' },
                  {
                    onSuccess: () => {
                      toast.success('Changes requested.')
                    },
                  },
                )
              }}
            >
              <ArrowCounterClockwise aria-hidden="true" />
              Request changes
            </Button>

            {/*
              Only once the deadline is behind us. Before that the routine
              refuses, so a button here would be a promise the server would
              break; the countdown beside it is what says why not yet.
            */}
            {reviewOver ? (
              <Button
                onClick={() => {
                  setCompleting(true)
                }}
              >
                <CheckCircle aria-hidden="true" weight="fill" />
                Mark as done
              </Button>
            ) : null}

            <CompleteProjectDialog
              open={completing}
              onOpenChange={setCompleting}
              lifecycle={lifecycle}
              unfinished={unfinished}
            />
          </>
        ) : null}
      </div>
    )
  }

  // Done. There is no next thing, and drawing a disabled button to say so
  // would be an interface insisting on having something to offer.
  return (
    <p className="text-muted-foreground text-2xs inline-flex items-center gap-1.5">
      <CheckCircle aria-hidden="true" weight="fill" className="text-success size-3.5" />
      Completed
    </p>
  )
}
