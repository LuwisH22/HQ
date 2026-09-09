import { describe, expect, it } from 'vitest'
import { routeProjectChange, routeProjectsListChange, type Change } from './project-realtime'

/**
 * Where a change lands.
 *
 * The whole of realtime's judgement is here: which family a row belongs to,
 * and which rows are somebody else's business. Everyone in an organization who
 * may view projects may view all of them, so a topic hears about projects that
 * are not on screen — and getting this wrong is quiet either way. Too broad and
 * the board redraws whenever anything anywhere changes; too narrow and the
 * screen goes stale without saying so.
 */

const ORG = '3eddb674-7045-42aa-b9c5-7df5b9742486'
const OTHER_ORG = '00000000-0000-4000-8000-000000000000'
const PROJECT = '11111111-1111-4111-8111-111111111111'
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222'
const TASK = '33333333-3333-4333-8333-333333333333'

const scope = { organizationId: ORG, projectId: PROJECT }
const route = (change: Change) => routeProjectChange(change, scope)

/** An insert or update: the row, as the subscriber is allowed to see it. */
const wrote = (table: string, row: Record<string, unknown>): Change => ({
  table,
  new: row,
  old: {},
})
/**
 * A delete: the primary key and nothing else, which is all replica identity
 * default publishes and all a client that refetches needs.
 */
const deleted = (table: string): Change => ({ table, new: {}, old: { id: 'gone' } })
/** What a subscriber who may not read the row receives: an empty envelope. */
const unauthorized = (table: string): Change => ({ table, new: {}, old: {} })

const list = ['projects', ORG, 'list']
const detail = ['projects', ORG, 'detail', PROJECT]
const members = ['projects', ORG, 'detail', PROJECT, 'members']
const labels = ['projects', ORG, 'detail', PROJECT, 'labels']
const comments = ['projects', ORG, 'comments', TASK]
const review = ['projects', ORG, 'detail', PROJECT, 'review']
const overview = ['projects', ORG, 'overview']
const everyComment = ['projects', ORG, 'comments']

describe('a project itself', () => {
  it('refreshes this project and the list when this project changes', () => {
    expect(route(wrote('projects', { id: PROJECT, organization_id: ORG }))).toEqual({
      keys: [list, detail],
      board: false,
    })
  })

  it('refreshes only the list when a different project changes', () => {
    expect(route(wrote('projects', { id: OTHER_PROJECT, organization_id: ORG }))).toEqual({
      keys: [list],
      board: false,
    })
  })

  it('ignores another organization entirely', () => {
    expect(route(wrote('projects', { id: OTHER_PROJECT, organization_id: OTHER_ORG }))).toEqual({
      keys: [],
      board: false,
    })
  })

  it('knows which project was deleted, because the key it carries is that id', () => {
    expect(route({ table: 'projects', new: {}, old: { id: PROJECT } })).toEqual({
      keys: [list, detail],
      board: false,
    })
    expect(route({ table: 'projects', new: {}, old: { id: OTHER_PROJECT } })).toEqual({
      keys: [list],
      board: false,
    })
  })
})

describe('the board', () => {
  it('marks the board stale when a task on this project changes', () => {
    expect(route(wrote('tasks', { id: 't1', project_id: PROJECT }))).toEqual({
      keys: [],
      board: true,
    })
  })

  it('leaves the board alone when the task belongs to another project', () => {
    expect(route(wrote('tasks', { id: 't1', project_id: OTHER_PROJECT }))).toEqual({
      keys: [],
      board: false,
    })
  })

  it('treats a deleted task as news, because the payload names no project', () => {
    expect(route(deleted('tasks'))).toEqual({ keys: [], board: true })
  })

  it('refreshes the board for a label put on or taken off any task', () => {
    // `task_labels` names a task and a label and never a project, and a cache
    // that does not hold the task cannot prove the task is somebody else's
    // rather than one created a moment ago. One indexed read is the price of
    // never dropping a real one.
    expect(route(wrote('task_labels', { task_id: TASK, label_id: 'l1' }))).toEqual({
      keys: [],
      board: true,
    })
    expect(route(deleted('task_labels'))).toEqual({ keys: [], board: true })
  })

  it('does not redraw the board when a label is merely renamed', () => {
    // A card holds label ids and reads names from the catalogue, so the rows
    // the board is holding are still correct.
    expect(route(wrote('project_labels', { id: 'l1', project_id: PROJECT }))).toEqual({
      keys: [labels],
      board: false,
    })
  })

  it('ignores a label belonging to another project', () => {
    expect(route(wrote('project_labels', { id: 'l1', project_id: OTHER_PROJECT }))).toEqual({
      keys: [],
      board: false,
    })
  })
})

describe('the roster', () => {
  it('refreshes the roster on screen and the head count on the list', () => {
    expect(route(wrote('project_members', { project_id: PROJECT }))).toEqual({
      keys: [members, list],
      board: false,
    })
  })

  it('ignores another project roster', () => {
    expect(route(wrote('project_members', { project_id: OTHER_PROJECT }))).toEqual({
      keys: [],
      board: false,
    })
  })
})

describe('comments', () => {
  it('refreshes exactly the task that was commented on', () => {
    expect(route(wrote('task_comments', { id: 'c1', task_id: TASK }))).toEqual({
      keys: [comments],
      board: false,
    })
  })

  it('refreshes the same one task when a comment is taken back', () => {
    // A soft delete is an update and carries its task like any other.
    expect(
      route({
        table: 'task_comments',
        new: { id: 'c1', task_id: TASK, body: '', deleted_at: '2026-09-09T06:41:50Z' },
        old: { id: 'c1' },
      }),
    ).toEqual({ keys: [comments], board: false })
  })

  it('marks every task comment stale when the row cannot be placed', () => {
    // A real delete — the cascade when a task itself goes — carries only an id.
    // At most one task has its comments on screen, so the prefix is cheap.
    expect(route(deleted('task_comments'))).toEqual({ keys: [everyComment], board: false })
  })

  it('never carries a comment body into a cache', () => {
    const refresh = route(wrote('task_comments', { id: 'c1', task_id: TASK, body: 'secret' }))

    // Only keys come out of here. Nothing that arrives on the socket is
    // written anywhere: the refetch that follows goes through RLS.
    expect(JSON.stringify(refresh)).not.toContain('secret')
  })
})

describe('the review conversation', () => {
  it('refreshes only the review when somebody comments on this project', () => {
    expect(route(wrote('project_review_comments', { id: 'r1', project_id: PROJECT }))).toEqual({
      keys: [review],
      board: false,
    })
  })

  it('ignores a review comment on another project', () => {
    expect(
      route(wrote('project_review_comments', { id: 'r1', project_id: OTHER_PROJECT })),
    ).toEqual({ keys: [], board: false })
  })

  it('never carries a review comment body into a cache', () => {
    const refresh = route(
      wrote('project_review_comments', { id: 'r1', project_id: PROJECT, body: 'secret' }),
    )

    expect(JSON.stringify(refresh)).not.toContain('secret')
  })

  it('treats a deleted review comment as news about this project', () => {
    // A soft delete carries its project like any update; a real delete — the
    // cascade when the project itself goes — carries only an id, and cannot be
    // attributed, so it is treated as ours.
    expect(route(deleted('project_review_comments'))).toEqual({ keys: [review], board: false })
  })
})

describe('what cannot be attributed', () => {
  it('treats an unauthorized envelope as news, per table', () => {
    expect(route(unauthorized('tasks'))).toEqual({ keys: [], board: true })
    expect(route(unauthorized('projects'))).toEqual({ keys: [list, detail], board: false })
    expect(route(unauthorized('task_comments'))).toEqual({ keys: [everyComment], board: false })
  })

  it('ignores a table nobody subscribed to', () => {
    expect(route(wrote('messages', { id: 'm1' }))).toEqual({ keys: [], board: false })
  })
})

describe('the list on its own', () => {
  it('refreshes the list when a project in this organization changes', () => {
    expect(routeProjectsListChange(wrote('projects', { organization_id: ORG }), ORG)).toEqual({
      keys: [list],
      board: false,
    })
  })

  it('ignores another organization', () => {
    expect(routeProjectsListChange(wrote('projects', { organization_id: OTHER_ORG }), ORG)).toEqual({
      keys: [],
      board: false,
    })
  })

  it('refreshes the list when a roster changes, because it draws the count', () => {
    expect(routeProjectsListChange(wrote('project_members', { project_id: PROJECT }), ORG)).toEqual({
      keys: [list],
      board: false,
    })
  })

  it('refreshes who is working on things when a task changes', () => {
    // Not the board, which the list does not draw, and not the projects
    // themselves: only the derived counts and avatars, which is exactly what a
    // task being assigned or finished makes wrong.
    expect(routeProjectsListChange(wrote('tasks', { project_id: PROJECT }), ORG)).toEqual({
      keys: [overview],
      board: false,
    })
    expect(routeProjectsListChange(deleted('tasks'), ORG)).toEqual({
      keys: [overview],
      board: false,
    })
  })

  it('hears nothing about comments at all', () => {
    expect(routeProjectsListChange(wrote('task_comments', { task_id: TASK }), ORG)).toEqual({
      keys: [],
      board: false,
    })
    expect(
      routeProjectsListChange(wrote('project_review_comments', { project_id: PROJECT }), ORG),
    ).toEqual({ keys: [], board: false })
  })
})
