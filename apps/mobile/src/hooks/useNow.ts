import { useEffect, useState } from 'react'

/**
 * A coarse clock for countdown labels ("next retry in 4m"). Nothing else
 * re-renders a row whose data hasn't changed, so without this tick the
 * countdown would freeze.
 */
export function useNow(intervalMs: number = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
