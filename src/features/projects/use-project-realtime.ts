import { useEffect, useMemo, useRef } from 'react'
import { useIsMutating, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/query-keys'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { routeProjectChange, routeProjectsListChange, type Change, type Refresh } from './project-realtime'

/**
 * Projects, kept current while somebody is looking at them.
 *
 * The same architecture the calendar has used since 5.3C, because it was
 * already proven against the live project rather than assumed: one topic,
 * Postgres Changes, no broadcast and no presence, so nothing is opened
 * `private` and no policy on `realtime.messages` is needed. Delivery is scoped
 * by the same `select` policies the queries obey — measured, not hoped for.
 *
 * Two facts were re-measured for these six tables before any of it was
 * written, because a comment is not a calendar event:
 *
 *   · a payload carries only the columns the subscriber may select. 6.3 put a
 *     deleted comment's words in `deleted_body` and granted every column but
 *     that one; an insert and the update that follows a soft delete both
 *     arrive with exactly the eight granted columns. The words never leave the
 *     database, so publishing `task_comments` does not undo that model.
 *   · a delete arrives as a bare primary key, to everybody who may read the
 *     table. Replica identity stays default for exactly that reason.
 *
 * The subscriptions are unfiltered. A server-side `filter` can only match on
 * columns the payload carries, and a deletion carries one — so scope is
 * checked in the handler, where a row that cannot be placed is treated as news
 * rather than discarded.
 */

/** Everything one open project is made of. */
const PROJECT_TABLES = [
  'projects',
  'project_members',
  'tasks',
  'project_labels',
  'task_labels',
  'task_comments',
  'project_review_comments',
] as const

/**
 * What the list is made of: the projects, the head count beside each, and the
 * tasks that decide who is shown as working on one.
 *
 * Tasks are here and the board is not. The list draws avatars and a count
 * derived from assignment, so it has to hear about a task being assigned,
 * finished or deleted — but it has no board to redraw, and the overview is a
 * family of its own so hearing about one does not refetch every project.
 */
const LIST_TABLES = ['projects', 'project_members', 'tasks'] as const

/**
 * The socket half: join a topic, hear about some tables, leave.
 *
 * The handler is read from a ref rather than closed over, so a component that
 * re-renders — which a board does constantly while a card is being dragged —
 * does not tear down and rebuild its subscription.
 */
function useChangeFeed(
  topic: string,
  tables: readonly string[],
  enabled: boolean,
  onChange: (change: Change) => void,
  onConnect: () => void,
): void {
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const connectRef = useRef(onConnect)
  connectRef.current = onConnect

  const signature = tables.join(',')

  useEffect(() => {
    if (!enabled || isDemoSessionActive()) return

    const supabase = getSupabase()

    // StrictMode runs an effect twice in development and `removeChannel` is
    // asynchronous, so the second run can find the first channel still
    // registered under this topic — and Supabase hands back the same object,
    // where a second `.on()` after `subscribe()` throws. Clearing it first
    // makes one subscription per topic true rather than hoped for.
    for (const existing of supabase.getChannels()) {
      if (existing.topic === topic || existing.topic === `realtime:${topic}`) {
        void supabase.removeChannel(existing)
      }
    }

    let channel = supabase.channel(topic)
    for (const table of signature.split(',')) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        changeRef.current({ table, new: payload.new, old: payload.old })
      })
    }

    // The moment the stream is actually running.
    //
    // SUBSCRIBED is the join being acknowledged; the replication connection
    // behind it is established afterwards, and the server says so with a
    // `system` message of its own. Everything written in between is published
    // to nobody on this channel — which was not theory: the first run of the
    // end-to-end spec created a task a few hundred milliseconds after the
    // board appeared, and the board never heard about it.
    channel = channel.on('system', {}, (payload: { extension?: string }) => {
      if (payload.extension === 'postgres_changes') connectRef.current()
    })

    channel.subscribe((status) => {
      // And once more on the join itself, because that one is guaranteed. Two
      // small reads on connect is the price of not depending on a message that
      // may never come if replication cannot be established at all — in which
      // case being current once is better than being current never.
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) connectRef.current()
      // Every other status is left alone on purpose. The queries are the
      // source of truth and keep working; a transient reconnect is not
      // something to put on the screen.
    })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [topic, signature, enabled])
}

/** Mark a set of families stale. Never a cache write: see `project-realtime`. */
function invalidate(client: QueryClient, keys: Refresh['keys']): void {
  for (const key of keys) {
    void client.invalidateQueries({ queryKey: key })
  }
}

/**
 * One open project.
 *
 * Everything on the page moves: cards appear and are dragged away, labels go
 * on and come off, people are added to the roster, somebody comments. Each of
 * those wakes the smallest family that draws it, so a comment never redraws
 * the board and a drag never disturbs a conversation.
 *
 * The one exception is the board itself, which is the only family a client can
 * be holding an unconfirmed copy of. While a board write is in flight — a card
 * that has been dropped and is on its way to the server, with the optimistic
 * arrangement on screen — a refetch would answer with the arrangement from
 * before the move and the card would jump back, then forward again when the
 * write landed. So a board refresh that arrives during that window is
 * remembered rather than dropped, and run the moment the write settles. It is
 * remembered rather than left to the mutation's own refetch because a write
 * that fails never refetches, and news that arrived while it was failing is
 * still news.
 *
 * That is the whole of the reconciliation. There is no merge and no CRDT:
 * server order is the only order, and the optimistic board is computed by the
 * same arithmetic the routine uses, so the two agree by construction.
 */
export function useProjectRealtime(
  organizationId: string | undefined,
  projectId: string | undefined,
  enabled = true,
): void {
  const queryClient = useQueryClient()
  // The same stand-in the queries use when they are disabled, so the keys
  // built here and the keys built there are one set of keys.
  const org = organizationId ?? 'none'
  const project = projectId ?? 'none'

  const boardKey = useMemo(() => queryKeys.projects.tasks(org, project), [org, project])

  // Counted rather than watched: every write that touches the board carries
  // this key, so one number says whether the board on screen is still waiting
  // to be confirmed by the server.
  const writing = useIsMutating({ mutationKey: boardKey }) > 0
  const writingRef = useRef(writing)
  writingRef.current = writing
  const owed = useRef(false)

  useEffect(() => {
    if (writing || !owed.current) return
    owed.current = false
    void queryClient.invalidateQueries({ queryKey: boardKey })
  }, [writing, boardKey, queryClient])

  useChangeFeed(
    `project:${project}`,
    PROJECT_TABLES,
    Boolean(organizationId) && Boolean(projectId) && enabled,
    (change) => {
      const refresh = routeProjectChange(change, { organizationId: org, projectId: project })
      invalidate(queryClient, refresh.keys)
      if (!refresh.board) return
      if (writingRef.current) owed.current = true
      else void queryClient.invalidateQueries({ queryKey: boardKey })
    },
    () => {
      // A fresh connection has missed whatever happened while it was gone, and
      // has no way to find out what. Everything this topic covers is marked
      // stale; only what is actually on screen pays for it.
      invalidate(queryClient, [
        queryKeys.projects.detail(org, project),
        queryKeys.projects.members(org, project),
        queryKeys.projects.labels(org, project),
        queryKeys.projects.review(org, project),
        queryKeys.projects.commentsAll(org),
      ])
      if (writingRef.current) owed.current = true
      else void queryClient.invalidateQueries({ queryKey: boardKey })
    },
  )
}

/**
 * The list of projects.
 *
 * Its own topic rather than a share of the project one, because the two pages
 * want different things: a list wants to know that a project was created,
 * renamed or archived and how many people are on it, and nothing about the
 * work inside one. Subscribing it to tasks and comments would mean a socket
 * carrying every card and every word in the organization to a screen that
 * draws neither.
 */
export function useProjectsRealtime(organizationId: string | undefined, enabled = true): void {
  const queryClient = useQueryClient()
  const org = organizationId ?? 'none'

  useChangeFeed(
    `projects:${org}`,
    LIST_TABLES,
    Boolean(organizationId) && enabled,
    (change) => {
      invalidate(queryClient, routeProjectsListChange(change, org).keys)
    },
    () => {
      invalidate(queryClient, [
        queryKeys.projects.list(org),
        queryKeys.projects.overview(org),
      ])
    },
  )
}
