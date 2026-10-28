import { useEffect, useState } from 'react'

/** A first click arms the action and a second within 3 seconds takes it. */
export function useConfirm(): [boolean, (armed: boolean) => void] {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3_000)
    return () => clearTimeout(timer)
  }, [armed])
  return [armed, setArmed]
}
