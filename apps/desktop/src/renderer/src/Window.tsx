/*
 * What the window shows.
 *
 * Sign-in until there is an account, then the status view.
 */

import { useApp } from '@siastorage/core/app'
import { useCallback, useEffect, useState } from 'react'
import { sia } from './api'
import { Details } from './Details'
import { useReportedHeight } from './height'
import { SignIn } from './SignIn'

export function Window() {
  const app = useApp()
  const root = useReportedHeight<HTMLDivElement>()
  const [needsAccount, setNeedsAccount] = useState<boolean | null>(null)

  const read = useCallback(async () => {
    try {
      const url = await app.settings.getIndexerURL()
      setNeedsAccount(!(await app.auth.hasAppKey(url)))
    } catch {
      // With the daemon down the read rejects. Sign-in is where the outage is
      // named, so showing it beats a window that stays blank.
      setNeedsAccount(true)
    }
  }, [app])

  useEffect(() => {
    void read()
    // The daemon reports a connection change, which is what signing in causes.
    // Other scopes arrive several times a second during a sync, and each read
    // is two daemon round trips.
    return sia.onChange((event) => {
      if (event.scope === 'connection') void read()
    })
  }, [read])

  return (
    <div ref={root}>
      <div aria-hidden className="drag-strip" />
      {needsAccount === null ? null : needsAccount ? (
        <SignIn onDone={() => void read()} />
      ) : (
        <Details />
      )}
    </div>
  )
}
