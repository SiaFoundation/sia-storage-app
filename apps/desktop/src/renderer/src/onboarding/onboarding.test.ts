import { describe, expect, it } from 'bun:test'
import { CARD, CARDS, shuffledCells } from './cards'
import { FILES, FOLDERS } from './library'
import { KEPT, NEEDED, PIECES } from './ShardField'
import { seededShard } from './shards'
import { moved, slides } from './slides'

describe('a shard', () => {
  it('is the same for a seed every time it is drawn', () => {
    expect(seededShard('piece-7')).toEqual(seededShard('piece-7'))
  })

  it('fits the 3 by 3 grid and never puts one colour on two touching blocks', () => {
    for (let index = 0; index < PIECES; index++) {
      const blocks = seededShard(`piece-${index}`)
      expect(blocks.length).toBeGreaterThan(0)
      for (const block of blocks) {
        expect(block.x).toBeGreaterThanOrEqual(0)
        expect(block.x).toBeLessThan(3)
        expect(block.y).toBeGreaterThanOrEqual(0)
        expect(block.y).toBeLessThan(3)
        const touching = blocks.filter(
          (other) => Math.abs(other.x - block.x) + Math.abs(other.y - block.y) === 1,
        )
        expect(touching.every((other) => other.color !== block.color)).toBe(true)
      }
    }
  })

  it('differs between pieces, so 30 of them do not read as one shape repeated', () => {
    const drawn = new Set(
      Array.from({ length: PIECES }, (_, index) => JSON.stringify(seededShard(`piece-${index}`))),
    )
    expect(drawn.size).toBeGreaterThan(PIECES / 2)
  })
})

describe('the pieces a file needs', () => {
  it('are 10 of its 30', () => {
    expect(PIECES).toBe(30)
    expect(NEEDED).toBe(10)
    expect(KEPT.size).toBe(NEEDED)
    expect([...KEPT].every((index) => index >= 0 && index < PIECES)).toBe(true)
  })
})

describe('an encrypted card', () => {
  const count = CARD.cols * CARD.rows

  it('keeps every cell of the card exactly once', () => {
    const order = shuffledCells('earth', count)

    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i))
  })

  it('moves the cells, so the picture is gone', () => {
    const order = shuffledCells('earth', count)
    const inPlace = order.filter((from: number, to: number) => from === to).length

    expect(inPlace).toBeLessThan(count / 10)
  })

  it('is shuffled the same way every time, and differently for another card', () => {
    expect(shuffledCells('earth', count)).toEqual(shuffledCells('earth', count))
    expect(shuffledCells('earth', count)).not.toEqual(shuffledCells('saturn', count))
  })
})

describe('the pile', () => {
  it('mixes photos and documents, each under a name of its own', () => {
    expect(CARDS.filter((card) => card.kind === 'photo').length).toBe(3)
    expect(CARDS.filter((card) => card.kind === 'document').length).toBe(3)
    expect(new Set(CARDS.map((card) => card.id)).size).toBe(CARDS.length)
  })
})

describe('the tour', () => {
  const tour = slides('Sia Storage Dev')

  it('covers what happens to a file, then where the files are', () => {
    expect(tour.map((slide) => slide.id)).toEqual([
      'encrypt',
      'split',
      'distribute',
      'finder',
      'phone',
    ])
  })

  it("names this build's Finder folder", () => {
    const finder = tour.find((slide) => slide.id === 'finder')

    expect(finder?.body).toContain('Look for Sia Storage Dev in the Finder sidebar')
  })

  it('stops at its first and last slides', () => {
    expect(moved(0, -1, tour.length)).toBe(0)
    expect(moved(0, 1, tour.length)).toBe(1)
    expect(moved(tour.length - 1, 1, tour.length)).toBe(tour.length - 1)
  })
})

describe('the library the Finder and phone mocks share', () => {
  it('has folders and files for both to show', () => {
    expect(FOLDERS.length).toBeGreaterThan(0)
    expect(FILES.length).toBeGreaterThan(0)
    expect(new Set([...FOLDERS, ...FILES].map((entry) => entry.name)).size).toBe(
      FOLDERS.length + FILES.length,
    )
  })
})
