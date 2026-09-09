import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Kanban, Plus } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Can } from '@/components/common/Can'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState, ErrorState, ForbiddenState, ListSkeleton } from '@/components/common/states'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import type { Project } from '@/services/project.service'
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES } from './project-status'
import { ProjectRow } from './ProjectRow'
import { CreateProjectDialog } from './CreateProjectDialog'
import { useProjectOverview, useProjects } from './use-projects'
import { useProjectsRealtime } from './use-project-realtime'

/**
 * Everything this organization is working on.
 *
 * Grouped by status rather than sorted by it, because "what is happening" and
 * "what has been put away" are different questions and a single list makes the
 * reader do that sorting themselves. A group with nothing in it is not drawn:
 * four headings over one project would be a form, not a list.
 */
export function ProjectsPage() {
  const { organization } = useWorkspace()
  const canView = usePermission('projects.view')
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  const query = useProjects(organization?.id, canView)
  // A second, smaller query: counts and who is carrying the work go stale for
  // different reasons than a project's own row does, and finishing a task
  // should redraw a line of avatars rather than the whole list.
  const overview = useProjectOverview(organization?.id, canView)
  // Somebody else creating, renaming or archiving a project should not need
  // this list to be reopened before it says so.
  useProjectsRealtime(organization?.id, canView)

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-4 sm:px-6">
        <ForbiddenState description="Your role does not include access to projects." />
      </div>
    )
  }

  const projects = query.data ?? []
  const overviews = new Map((overview.data ?? []).map((row) => [row.projectId, row]))

  /*
   * Grouped by stage, and archived is not one of them.
   *
   * Archiving used to overwrite the stage, so a put-away project could only be
   * filed under "Archived". Now it keeps where it got to, which means it needs
   * a group of its own at the bottom rather than a stage it never reached — a
   * project archived half way through review is still half way through review.
   */
  const active = projects.filter((project) => project.archivedAt === null)
  const groups: { key: string; label: string; items: Project[] }[] = PROJECT_STATUSES.map(
    (status) => ({
      key: status,
      label: PROJECT_STATUS_LABELS[status],
      items: active.filter((project) => project.status === status),
    }),
  )
  groups.push({
    key: 'archived',
    label: 'Archived',
    items: projects.filter((project) => project.archivedAt !== null),
  })

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-5 px-4 pt-4 pb-8 sm:px-6 sm:pt-5">
      <PageHeader
        eyebrow="Work"
        title="Projects"
        description={`Bootcamps, content and everything else in flight at ${organization?.name ?? 'your organization'}.`}
        actions={
          // Hidden rather than disabled, as every other permission-gated
          // action in this application is. The database refuses it either way.
          <Can perm="projects.create">
            <Button
              onClick={() => {
                setCreating(true)
              }}
            >
              <Plus aria-hidden="true" />
              New project
            </Button>
          </Can>
        }
      />

      {query.isPending ? <ListSkeleton rows={4} /> : null}

      {query.isError ? (
        <ErrorState
          error={query.error}
          onRetry={() => {
            void query.refetch()
          }}
        />
      ) : null}

      {!query.isPending && !query.isError && projects.length === 0 ? (
        <EmptyState
          icon={Kanban}
          title="No projects yet"
          description="A project is somewhere to keep a bootcamp, a content push or a sponsorship together."
        />
      ) : null}

      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section
            key={group.key}
            aria-labelledby={`projects-${group.key}`}
            className="space-y-2"
          >
            <h2
              id={`projects-${group.key}`}
              className="display-eyebrow text-3xs text-muted-foreground"
            >
              {group.label}
            </h2>
            <ul className="space-y-1.5">
              {group.items.map((project: Project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  overview={overviews.get(project.id)}
                />
              ))}
            </ul>
          </section>
        ))}

      <CreateProjectDialog
        open={creating}
        onOpenChange={setCreating}
        organizationId={organization?.id ?? ''}
        onCreated={(projectId) => {
          // Straight into the thing that was just made, which is where
          // somebody is going next anyway.
          void navigate(`/projects/${projectId}`)
        }}
      />
    </div>
  )
}
