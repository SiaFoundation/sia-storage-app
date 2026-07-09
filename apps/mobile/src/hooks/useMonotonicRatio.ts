import { useRef } from 'react'

/**
 * High-water progress ratio. The raw ratio can regress: appending to an open
 * import grows the denominator, a retried row re-zeroes its copyBytes, and
 * summary fetches can resolve out of order. The bar shows the high-water mark
 * instead; resets once the import leaves the importing state.
 */
export function useMonotonicRatio(importing: boolean, ratio: number): number {
  const max = useRef(0)
  const clamped = Math.max(max.current, ratio)
  max.current = importing ? clamped : 0
  return clamped
}
