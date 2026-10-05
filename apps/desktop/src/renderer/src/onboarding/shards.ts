/*
 * Seeded randomness for the onboarding pictures, so a card is laid out and
 * animated the same way on every render.
 */

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
