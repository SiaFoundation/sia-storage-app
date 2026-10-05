import { describe, expect, it } from 'bun:test'
import { CARD, CARDS, shuffledCells } from './cards'

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
