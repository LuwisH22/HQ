import { AvatarStack, type StackedPerson } from '@/components/common/AvatarStack'
import type { ProjectWorker } from '@/services/project.service'

/**
 * Who currently has unfinished work on a project.
 *
 * Not the roster. A project can be for six people while two of them are
 * actually carrying something, and "6 members" told a reader neither of those
 * things. This is derived from assignment — somebody with at least one task
 * here that is not done — so it cannot go stale the way a second stored
 * relationship would.
 *
 * It says nothing about presence. Nobody here is online, recently seen, or
 * available; they have work open, which is a fact about the board.
 */
export function WorkerAvatars({
  workers,
  limit = 4,
  className,
}: {
  workers: readonly ProjectWorker[]
  limit?: number
  className?: string
}) {
  const people: StackedPerson[] = workers.map((worker) => ({
    id: worker.memberId,
    name: worker.name,
    avatarUrl: worker.avatarUrl,
    detail: `${String(worker.openTasks)} open`,
  }))

  return (
    <AvatarStack
      people={people}
      limit={limit}
      summaryLabel="Working on it"
      emptyLabel="No active assignees"
      className={className}
    />
  )
}
