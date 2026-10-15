/*
 * The card that says an update has downloaded, above the status in the
 * popover and the window. Restart quits, installs and relaunches, so the app
 * waits for the click rather than restarting under someone mid-task.
 */

import { useEffect, useState } from 'react'
import { sia, type UpdateState } from './api'
import { PRIMARY_BUTTON } from './buttons'
import { ArrowCircle } from './icons'

export function UpdateNotice() {
  const update = useUpdate()
  if (update?.status !== 'ready') return null

  return (
    <div
      role="status"
      data-testid="update-ready"
      className="flex items-center gap-2 rounded-card bg-card px-row-x py-[9px]"
    >
      <span aria-hidden className="flex w-[15px] shrink-0 justify-center text-accent">
        <ArrowCircle down />
      </span>
      <p className="m-0 min-w-0 flex-auto text-[12px] leading-[1.35] text-pretty">
        Version {update.version} is ready to install.
      </p>
      <button
        type="button"
        className={`${PRIMARY_BUTTON} shrink-0`}
        onClick={() => void sia.installUpdate()}
      >
        Restart
      </button>
    </div>
  )
}

/** Null until the main process answers. Follows every change after that. */
function useUpdate(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    let live = true
    // Subscribed before asking, so a change landing between the two is not lost.
    const stop = sia.onUpdate((next) => setState(next))
    sia
      .updateState()
      .then((answer) => {
        if (live) setState((seen) => seen ?? answer)
      })
      .catch(() => {})
    return () => {
      live = false
      stop()
    }
  }, [])

  return state
}
