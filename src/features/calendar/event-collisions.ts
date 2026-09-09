/**
 * Where overlapping events sit beside each other.
 *
 * The grid places an event by the clock: its top is its minute and its height
 * is how long it lasts. That answers "when" and says nothing about "where
 * across", so every event was drawn at the full width of its day and two
 * events at the same hour were drawn on top of one another.
 *
 * This is the missing half, and it is arithmetic on intervals rather than on
 * anything the browser has measured — no pixels, no rects, no layout pass to
 * wait for. Two events collide when one starts before the other ends and ends
 * after the other starts; an event finishing exactly as the next begins is not
 * a collision, which is the difference between 10–11 and 11–12 keeping their
 * full width and 10–11 and 10:30–11:30 sharing it.
 *
 * The shape of the answer is a fraction of the column, so the caller decides
 * what a column is worth in pixels and this never has to know.
 */

/** Any interval on any scale. The algorithm only ever compares two numbers. */
export interface TimeSpan {
  start: number
  /** Exclusive, as the calendar stores it everywhere else. */
  end: number
}

export interface Placement {
  /** Which column within its group of overlapping events, from zero. */
  columnIndex: number
  /** How many columns that group needed. */
  columnCount: number
  /** Fraction of the day's width, 0–1, from the left edge. */
  left: number
  /** Fraction of the day's width. Never takes `left + width` past 1. */
  width: number
}

/** The rule, in one place, said once. */
function overlaps(a: TimeSpan, b: TimeSpan): boolean {
  return a.start < b.end && a.end > b.start
}

/**
 * A placement for every span, in the order they were given.
 *
 * Four passes, none of them clever:
 *
 *   1 · Sort. By start, then longest first, then by the order they arrived —
 *       a total order, so the same events always produce the same columns.
 *   2 · Cluster. A run of spans where each one starts before everything before
 *       it has finished. This is what stops a busy morning and a busy evening
 *       becoming one group of eight columns with six of them empty.
 *   3 · Column. Within a cluster, the first column whose last event has
 *       finished, or a new one. This is interval partitioning, and the number
 *       of columns it needs is exactly the most events happening at once.
 *   4 · Widen. A span then grows rightwards through columns that hold nothing
 *       overlapping it. Without this, A 10–11, B 10:30–11:30 and C 11–12 would
 *       each be a third of the width because the cluster has three members —
 *       when in truth only two of them are ever on screen together.
 *
 * Nothing here caps the number of columns: four simultaneous events get four,
 * and forty get forty. A calendar that quietly dropped the fifth would be
 * lying about the day.
 */
export function placeOverlapping(spans: readonly TimeSpan[]): Placement[] {
  const order = spans
    .map((span, index) => ({ span, index }))
    .sort(
      (a, b) =>
        a.span.start - b.span.start || b.span.end - a.span.end || a.index - b.index,
    )

  const placements = new Array<Placement>(spans.length)

  // One cluster at a time, so a column never reaches across a gap in the day.
  let cluster: { span: TimeSpan; index: number; column: number }[] = []
  let clusterEnd = Number.NEGATIVE_INFINITY

  const settle = () => {
    if (cluster.length === 0) return
    const columnCount = Math.max(...cluster.map((one) => one.column)) + 1

    for (const one of cluster) {
      // How far right it may reach before it would sit on something.
      let span = 1
      for (let column = one.column + 1; column < columnCount; column += 1) {
        const blocked = cluster.some(
          (other) => other.column === column && overlaps(other.span, one.span),
        )
        if (blocked) break
        span += 1
      }

      placements[one.index] = {
        columnIndex: one.column,
        columnCount,
        left: one.column / columnCount,
        width: span / columnCount,
      }
    }
    cluster = []
    clusterEnd = Number.NEGATIVE_INFINITY
  }

  for (const { span, index } of order) {
    // Starting exactly when the cluster ended is a new cluster: touching is
    // not overlapping, and the event is entitled to the whole width again.
    if (span.start >= clusterEnd) settle()

    // The first column that is free, counting a column as free when its last
    // event has finished by the time this one starts.
    const lastEnds = new Map<number, number>()
    for (const one of cluster) {
      lastEnds.set(one.column, Math.max(lastEnds.get(one.column) ?? -Infinity, one.span.end))
    }
    let column = 0
    while ((lastEnds.get(column) ?? -Infinity) > span.start) column += 1

    cluster.push({ span, index, column })
    clusterEnd = Math.max(clusterEnd, span.end)
  }
  settle()

  return placements
}
