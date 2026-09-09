import { describe, expect, it } from 'vitest'
import { placeOverlapping, type TimeSpan } from './event-collisions'

/**
 * Where overlapping events sit.
 *
 * Written in hours because the algorithm only compares numbers, and "10 to 11"
 * reads as a morning rather than as 36000000. Every case in the brief that
 * asked for a particular arrangement is here, including the ones that look
 * alike and are not: 10–11 with 11–12 is two full-width events, and 10–11 with
 * 10:30–11:30 is two halves.
 */

const at = (start: number, end: number): TimeSpan => ({ start, end })
/** Half past, so the fractions stay readable. */
const half = 0.5

describe('events that do not overlap', () => {
  it('leaves one event the whole width', () => {
    expect(placeOverlapping([at(10, 11)])).toEqual([
      { columnIndex: 0, columnCount: 1, left: 0, width: 1 },
    ])
  })

  it('gives adjacent events the whole width each', () => {
    // Touching is not overlapping: an event ending exactly as the next begins
    // takes nothing from it.
    const placed = placeOverlapping([at(10, 11), at(11, 12)])
    expect(placed.map((one) => one.width)).toEqual([1, 1])
    expect(placed.map((one) => one.columnIndex)).toEqual([0, 0])
  })

  it('gives events with a gap between them the whole width each', () => {
    const placed = placeOverlapping([at(9, 10), at(14, 15)])
    expect(placed.every((one) => one.width === 1 && one.left === 0)).toBe(true)
  })

  it('reuses a column rather than counting the whole day as one group', () => {
    // Three in a row: one column, three times over.
    const placed = placeOverlapping([at(9, 10), at(10, 11), at(11, 12)])
    expect(placed.map((one) => one.columnCount)).toEqual([1, 1, 1])
  })

  it('returns nothing for nothing', () => {
    expect(placeOverlapping([])).toEqual([])
  })
})

describe('events that do overlap', () => {
  it('puts two overlapping events in different columns, half each', () => {
    const placed = placeOverlapping([at(10, 11), at(10 + half, 11 + half)])
    expect(placed).toEqual([
      { columnIndex: 0, columnCount: 2, left: 0, width: half },
      { columnIndex: 1, columnCount: 2, left: half, width: half },
    ])
  })

  it('splits three simultaneous events into thirds', () => {
    const placed = placeOverlapping([at(10, 12), at(10 + half, 11 + half), at(10.75, 11.25)])
    expect(placed.map((one) => one.columnIndex)).toEqual([0, 1, 2])
    expect(placed.every((one) => one.columnCount === 3)).toBe(true)
    expect(placed.every((one) => Math.abs(one.width - 1 / 3) < 1e-9)).toBe(true)
  })

  it('handles four or more at once without a ceiling', () => {
    const many = [at(10, 12), at(10, 12), at(10, 12), at(10, 12), at(10, 12), at(10, 12)]
    const placed = placeOverlapping(many)
    expect(placed.map((one) => one.columnIndex)).toEqual([0, 1, 2, 3, 4, 5])
    expect(placed.every((one) => one.columnCount === 6)).toBe(true)
  })

  it('separates two events with identical start and end', () => {
    const placed = placeOverlapping([at(10, 12), at(10, 12)])
    expect(placed.map((one) => one.columnIndex)).toEqual([0, 1])
    expect(placed.map((one) => one.width)).toEqual([half, half])
  })

  it('separates a short event nested inside a long one', () => {
    const placed = placeOverlapping([at(10, 12), at(10 + half, 11)])
    expect(placed.map((one) => one.columnIndex)).toEqual([0, 1])
    expect(placed.map((one) => one.width)).toEqual([half, half])
  })

  it('keeps a long event beside several short ones inside it', () => {
    // 9–17 with three meetings in it, none of which overlap each other: two
    // columns, not four.
    const placed = placeOverlapping([at(9, 17), at(10, 11), at(12, 13), at(14, 15)])
    expect(placed.every((one) => one.columnCount === 2)).toBe(true)
    expect(placed[0]?.columnIndex).toBe(0)
    expect(placed.slice(1).every((one) => one.columnIndex === 1)).toBe(true)
  })
})

describe('a chain of overlaps', () => {
  // A overlaps B, B overlaps C, A does not overlap C — the case that a naive
  // "one group, one width" answer gets visibly wrong.
  const chain = [at(10, 11), at(10 + half, 11 + half), at(11, 12)]

  it('does not make the whole chain as narrow as its length', () => {
    const placed = placeOverlapping(chain)
    expect(placed.every((one) => one.columnCount === 2)).toBe(true)
    expect(placed.every((one) => one.width === half)).toBe(true)
  })

  it('lets the third event take the first column back', () => {
    const placed = placeOverlapping(chain)
    expect(placed.map((one) => one.columnIndex)).toEqual([0, 1, 0])
  })
})

describe('independent groups on the same day', () => {
  it('sizes each group by itself', () => {
    // A busy morning and one quiet afternoon event.
    const placed = placeOverlapping([at(9, 10), at(9 + half, 10 + half), at(15, 16)])
    expect(placed[0]?.columnCount).toBe(2)
    expect(placed[1]?.columnCount).toBe(2)
    expect(placed[2]).toEqual({ columnIndex: 0, columnCount: 1, left: 0, width: 1 })
  })

  it('does not let one group’s width leak into the next', () => {
    const placed = placeOverlapping([at(9, 12), at(10, 11), at(13, 14), at(15, 16)])
    expect(placed[2]?.width).toBe(1)
    expect(placed[3]?.width).toBe(1)
  })
})

describe('whatever it is given', () => {
  const cases: TimeSpan[][] = [
    [at(10, 12), at(10 + half, 11)],
    [at(10, 11), at(11, 12)],
    [at(10, 12), at(10, 12)],
    [at(10, 12), at(10 + half, 11 + half), at(10.75, 11.25)],
    [at(10, 11), at(10 + half, 11 + half), at(11, 12)],
    [at(9, 17), at(9, 10), at(9, 10), at(9, 10), at(13, 18)],
  ]

  it('never places an event outside the day', () => {
    for (const spans of cases) {
      for (const one of placeOverlapping(spans)) {
        expect(one.left).toBeGreaterThanOrEqual(0)
        expect(one.width).toBeGreaterThan(0)
        expect(one.left + one.width).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })

  it('gives every event a column inside the count', () => {
    for (const spans of cases) {
      for (const one of placeOverlapping(spans)) {
        expect(one.columnIndex).toBeGreaterThanOrEqual(0)
        expect(one.columnIndex).toBeLessThan(one.columnCount)
      }
    }
  })

  it('answers the same way twice, whatever order it is asked in', () => {
    const spans = cases[3] as TimeSpan[]
    const forwards = placeOverlapping(spans)
    const backwards = placeOverlapping([...spans].reverse()).reverse()
    expect(backwards).toEqual(forwards)
  })

  it('returns one placement per event, in the order given', () => {
    const spans = cases[5] as TimeSpan[]
    expect(placeOverlapping(spans)).toHaveLength(spans.length)
  })
})
