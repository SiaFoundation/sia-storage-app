/*
 * The shard shapes of the Sia brand: small figures of coloured blocks on a
 * 3 x 3 grid, one per piece a file is split into. The same shapes, palette and
 * seeding as sia.tech draws, so a piece looks the same here as it does there.
 */

export type ShardBlock = { x: number; y: number; color: string }

/** The five brand colours a block can take. Order matters: seeded shards shuffle this list. */
const PALETTE = ['#E50AAE', '#FF7919', '#C3E500', '#36D955', '#76E6EB']

/** Each shape as three rows of three cells, `1` filled. */
const SHAPES = [
  '000 110 000',
  '010 010 000',
  '000 111 000',
  '010 010 010',
  '110 110 000',
  '010 111 000',
  '000 111 010',
  '000 011 010',
  '000 110 010',
  '110 010 010',
  '000 111 100',
  '010 010 011',
  '010 110 100',
  '100 110 010',
  '011 110 000',
  '110 011 000',
  '010 111 010',
  '010 111 101',
  '011 001 011',
  '110 000 011',
  '111 110 100',
  '001 011 111',
  '111 101 111',
  '101 101 000',
  '110 101 011',
  '011 101 100',
  '011 111 110',
  '011 100 100',
  '001 001 110',
  '110 011 010',
  '100 111 010',
]

/** A deterministic random sequence in [0, 1) for a string seed. */
export function seededRandom(seed: string): () => number {
  let state = 2166136261
  for (let i = 0; i < seed.length; i++) {
    state = Math.imul(state ^ seed.charCodeAt(i), 16777619)
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The shard a seed stands for, the same one every time.
 *
 * Colours are handed out in turn from a shuffled palette. A shape has at most
 * eight blocks, so two share a colour only when they are five apart in row
 * order, and two blocks five apart on a 3 x 3 grid are never neighbours.
 */
export function seededShard(seed: string): ShardBlock[] {
  const random = seededRandom(seed)
  const shape = SHAPES[Math.floor(random() * SHAPES.length)] as string
  const colors = [...PALETTE]
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[colors[i], colors[j]] = [colors[j] as string, colors[i] as string]
  }
  const start = Math.floor(random() * colors.length)
  const cells = shape.replaceAll(' ', '')
  const blocks: ShardBlock[] = []
  for (let index = 0; index < cells.length; index++) {
    if (cells[index] !== '1') continue
    blocks.push({
      x: index % 3,
      y: Math.floor(index / 3),
      color: colors[(start + blocks.length) % colors.length] as string,
    })
  }
  return blocks
}
