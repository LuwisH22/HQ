import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Archive, ArrowUUpLeft, CaretLeft, PencilSimple, Tag, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, ForbiddenState } from '@/components/common/states'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { formatDate } from '@/utils/datetime'
import { PROJECT_STATUS_LABELS } from './project-status'
import { dateRange } from './project-dates'
import { EditProjectDialog } from './EditProjectDialog'
import { ArchiveProjectDialog } from './ArchiveProjectDialog'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { LifecycleTrack } from './LifecycleTrack'
import { ProjectWorkflow } from './ProjectWorkflow'
import { ProjectReviewPanel } from './ProjectReviewPanel'
import { ProjectMembersPanel } from './ProjectMembersPanel'
import { useProject, useProjectLifecycle } from './use-projects'
import { useTaskMutations, useTasks } from './use-tasks'
import { KanbanBoard } from './KanbanBoard'
import { CreateTaskDialog } from './CreateTaskDialog'
import { TaskDetailDialog } from './TaskDetailDialog'
import { useProjectMembers } from './use-projects'
import { useLabelMutations, useLabels } from './use-labels'
import { useProjectRealtime } from './use-project-realtime'
import { LabelManagerDialog } from './LabelManagerDialog'
import type { TaskStatus } from '@/types/database.types'

/**
 * One project.
 *
 * The header is the project — what it is, when it runs, who it is for and what
 * may be done to it — and the space below is the work. There is no work yet,
 * so that space says so plainly and does not promise anything: an empty state
 * that talks about what is coming is a roadmap, and a roadmap in a product is
 * a thing people wait for rather than use.
 */
export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { organization } = useWorkspace()
  const canView = usePermission('projects.view')
  const canManage = usePermission('projects.manage')
  const canArchive = usePermission('projects.delete')

  const canCreateTasks = usePermission('tasks.create')
  const canManageTasks = usePermission('tasks.manage')
  const canAssignTasks = usePermission('tasks.assign')

  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [addingTo, setAddingTo] = useState<TaskStatus | null>(null)
  // The id rather than the task: a snapshot goes stale the moment a label is
  // added or the card is moved, and the dialog would keep showing what was
  // true when it opened. Deriving it from the query also closes the dialog by
  // itself when the task is deleted.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [managingLabels, setManagingLabels] = useState(false)

  const query = useProject(organization?.id, projectId)
  const tasks = useTasks(organization?.id, projectId, canView)
  const members = useProjectMembers(organization?.id, projectId)
  const mutations = useTaskMutations(organization?.id, projectId)
  const labels = useLabels(organization?.id, projectId, canView)
  const openTask = (tasks.data ?? []).find((one) => one.id === openTaskId) ?? null

  // Somebody else deleting the task you are reading closes the dialog on its
  // own, because it is derived rather than copied. Closing without a word
  // reads like the application lost your place, so it says what happened —
  // except when it was you who deleted it, which announces itself already.
  const deletingTask = mutations.remove.isPending
  useEffect(() => {
    if (!openTaskId || !tasks.data || deletingTask) return
    if (tasks.data.some((one) => one.id === openTaskId)) return
    setOpenTaskId(null)
    toast.info('That task was deleted.')
  }, [openTaskId, tasks.data, deletingTask])
  const labelMutations = useLabelMutations(organization?.id, projectId)
  const lifecycle = useProjectLifecycle(organization?.id, projectId ?? 'none')
  const navigate = useNavigate()
  const { user } = useAuth()
  // One subscription for the whole page: the board, the roster, the labels and
  // whichever task's comments are open.
  useProjectRealtime(organization?.id, projectId, canView)

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-[1280px] px-4 py-4 sm:px-6">
        <ForbiddenState description="Your role does not include access to projects." />
      </div>
    )
  }

  const project = query.data ?? null
  // The column, not the stage. Archiving no longer overwrites where a project
  // got to, so "put away" and "half way through review" are both true at once.
  const archived = project?.archivedAt != null

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-5 px-4 pt-4 pb-8 sm:px-6 sm:pt-5">
      <Link
        to="/projects"
        className="text-muted-foreground hover:text-foreground text-2xs inline-flex items-center gap-1 transition-colors"
      >
        <CaretLeft className="size-3" aria-hidden="true" />
        Projects
      </Link>

      {query.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState
          error={query.error}
          onRetry={() => {
            void query.refetch()
          }}
        />
      ) : null}

      {/* A project that is not there, or is in an organization this reader
          cannot see, are the same answer: the policy returns no row either
          way, and saying which would be telling somebody something. */}
      {!query.isPending && !query.isError && !project ? (
        <EmptyState
          title="No such project"
          description="It may have been archived, or it belongs to another organization."
        />
      ) : null}

      {project ? (
        <>
          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="display-eyebrow text-3xs text-muted-foreground flex items-center gap-2">
                  {PROJECT_STATUS_LABELS[project.status]}
                  {archived ? (
                    <Badge variant="neutral" className="text-3xs">
                      Archived
                    </Badge>
                  ) : null}
                </p>
                <h1 className="mt-1 text-[22px] leading-7 font-semibold tracking-[-0.015em]">
                  {project.name}
                </h1>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {canManage ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEditing(true)
                    }}
                  >
                    <PencilSimple aria-hidden="true" />
                    Edit
                  </Button>
                ) : null}
                {canManageTasks && !archived ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setManagingLabels(true)
                    }}
                  >
                    <Tag aria-hidden="true" />
                    Labels
                  </Button>
                ) : null}
                {canArchive && !archived ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setArchiving(true)
                    }}
                  >
                    <Archive aria-hidden="true" />
                    Archive
                  </Button>
                ) : null}
                {canManage && archived ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={lifecycle.restore.isPending}
                    onClick={() => {
                      lifecycle.restore.mutate()
                    }}
                  >
                    <ArrowUUpLeft aria-hidden="true" />
                    Restore
                  </Button>
                ) : null}
                {/*
                  Deleting is not archiving, so it does not sit next to it
                  looking like a stronger version of the same idea: it is last,
                  quiet, and the only thing on the page drawn in the
                  destructive tone.
                */}
                {canArchive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setDeleting(true)
                    }}
                  >
                    <Trash aria-hidden="true" />
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>

            {/*
              Where it has got to, and the one thing to do next. Together,
              because "in review, ends in 3 hours, [Request changes]" is one
              sentence and splitting it across the page would make somebody
              assemble it themselves.
            */}
            {/*
              Stacked on a phone, side by side once there is room. Sharing one
              line at 390px left the track about sixty pixels to draw four
              stages in, and it collided with the countdown beside it — the
              page did not scroll sideways, so nothing caught it except
              looking.
            */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
              <LifecycleTrack
                status={project.status}
                compact
                className="min-w-0 sm:max-w-md sm:flex-1"
              />
              <div className="flex flex-wrap items-center gap-2">
                <ProjectWorkflow
                  project={project}
                  lifecycle={lifecycle}
                  canManage={canManage}
                  unfinished={(tasks.data ?? []).filter((task) => task.status !== 'done').length}
                />
              </div>
            </div>

            {project.description ? (
              <p className="text-secondary-foreground max-w-prose text-sm break-words whitespace-pre-wrap">
                {project.description}
              </p>
            ) : null}

            <div className="text-2xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
              {dateRange(project.startDate, project.dueDate) ? (
                <span>{dateRange(project.startDate, project.dueDate)}</span>
              ) : null}
              <span>Created {formatDate(project.createdAt)}</span>
              {project.updatedAt !== project.createdAt ? (
                <span>Updated {formatDate(project.updatedAt)}</span>
              ) : null}
            </div>
          </header>

          {/* The roster sits with the header, compact, so the board is what
              the page is mostly made of. */}
          <ProjectMembersPanel project={project} layout="row" />

          {/*
            The review conversation, once there is a review to have.
            Before a project has ever been sent to review there is nothing to
            discuss and a "Review 0" heading would be an empty promise; from
            the first round on it stays, including after changes are requested,
            because that history is the point of keeping it.
          */}
          {project.reviewRound > 0 || project.status === 'in_review' ? (
            <div className="border-border-subtle bg-surface rounded-md border px-3 py-3 sm:px-4">
              <ProjectReviewPanel
                organizationId={organization?.id}
                projectId={project.id}
                currentUserId={user?.id ?? null}
                canModerate={canManage}
                canWrite={!archived}
              />
            </div>
          ) : null}

          <KanbanBoard
            tasks={tasks.data ?? []}
            members={members.data ?? []}
            labels={labels.data ?? []}
            // An archived project keeps everything it has and takes nothing
            // new: the routines refuse either way, and the board stops
            // offering what would be refused.
            canCreate={canCreateTasks && !archived}
            canMove={canManageTasks && !archived}
            onMove={(move) => {
              mutations.move.mutate(move)
            }}
            onOpenTask={(task) => {
              setOpenTaskId(task.id)
            }}
            onNewTask={setAddingTo}
          />

          <CreateTaskDialog
            open={addingTo !== null}
            onOpenChange={(open) => {
              if (!open) setAddingTo(null)
            }}
            projectId={project.id}
            status={addingTo ?? 'todo'}
            members={members.data ?? []}
            canAssign={canAssignTasks && !archived}
            mutations={mutations}
          />
          <TaskDetailDialog
            task={openTask}
            members={members.data ?? []}
            labels={labels.data ?? []}
            labelMutations={labelMutations}
            organizationId={organization?.id}
            onOpenChange={(open) => {
              if (!open) setOpenTaskId(null)
            }}
            canManage={canManageTasks && !archived}
            canAssign={canAssignTasks && !archived}
            // Anybody who can see the task may comment on it; only archiving
            // takes that away.
            canComment={!archived}
            mutations={mutations}
          />

          <LabelManagerDialog
            open={managingLabels}
            onOpenChange={setManagingLabels}
            labels={labels.data ?? []}
            mutations={labelMutations}
          />

          <EditProjectDialog
            project={editing ? project : null}
            onOpenChange={(open) => {
              setEditing(open)
            }}
          />
          <DeleteProjectDialog
            project={deleting ? project : null}
            onOpenChange={(open) => {
              if (!open) setDeleting(false)
            }}
            onDeleted={() => {
              // There is nothing to come back to.
              void navigate('/projects')
            }}
          />
          <ArchiveProjectDialog
            project={archiving ? project : null}
            onOpenChange={(open) => {
              setArchiving(open)
            }}
          />
        </>
      ) : null}
    </div>
  )
}
