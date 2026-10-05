import { useEffect, useState } from 'react'
import { type AppInfo, sia } from './api'

/** Null until the main process has answered, and for good if it never does. */
export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let live = true
    sia
      .appInfo()
      .then((answer) => {
        if (live) setInfo(answer)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  return info
}
