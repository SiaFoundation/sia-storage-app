/*
 * The 30 pieces one file is split into, drawn as the brand's shards.
 *
 * Any 10 of them rebuild the file. `spare` shows that by fading 20 of them,
 * the same 20 every time, and leaving the rest lit.
 */

import { seededRandom, seededShard } from './shards'

export const PIECES = 30
/** How many of the pieces are enough to get the file back. */
export const NEEDED = 10

/** The pieces left lit when the rest are faded: a spread of 10, fixed by a seed. */
export const KEPT: ReadonlySet<number> = (() => {
  const random = seededRandom('kept')
  const order = Array.from({ length: PIECES }, (_, index) => index)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j] as number, order[i] as number]
  }
  return new Set(order.slice(0, NEEDED))
})()

export function ShardGlyph({ index, size = 30 }: { index: number; size?: number }) {
  return (
    <svg viewBox="0 0 30 30" width={size} height={size} aria-hidden="true">
      {seededShard(`piece-${index}`).map(({ x, y, color }) => (
        <rect key={`${x}:${y}`} x={x * 10} y={y * 10} width="10" height="10" fill={color} />
      ))}
    </svg>
  )
}

export function ShardField({ spare }: { spare: boolean }) {
  return (
    <div
      role="img"
      aria-label={`${PIECES} pieces of one file`}
      className="grid grid-cols-6 gap-x-[22px] gap-y-[18px]"
    >
      {Array.from({ length: PIECES }, (_, index) => (
        // Each piece arrives a beat after the one before it, row by row, so
        // the file reads as coming apart rather than being swapped out.
        <span key={index} className="animate-rise" style={{ animationDelay: `${index * 22}ms` }}>
          {/* The fade for `spare` is on an inner element, so the arrival
              animation and that transition never act on one element's
              opacity. */}
          <span
            className="block transition-opacity duration-300 ease-settle"
            style={{ opacity: spare && !KEPT.has(index) ? 0.16 : 1 }}
          >
            <ShardGlyph index={index} />
          </span>
        </span>
      ))}
    </div>
  )
}
