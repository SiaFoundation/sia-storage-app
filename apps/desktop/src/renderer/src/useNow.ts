import { useEffect, useState } from 'react'

/**
 * The time, moved on every minute. A view left open would otherwise keep the
 * relative times it drew when its list last changed.
 */
export function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
