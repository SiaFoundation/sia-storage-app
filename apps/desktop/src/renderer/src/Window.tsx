/*
 * What the window shows.
 *
 * Sign-in until there is an account, then the status view.
 *
 * The two are different widths, and the window is told which it is showing
 * before the view is measured.
 */

import { useApp } from '@siastorage/core/app'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
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

  const view = needsAccount === null ? null : needsAccount ? 'sign-in' : 'status'

  // A layout effect, so the width is on its way before the resize observer
  // reports the new view's height and the window is sized once, not twice.
  useLayoutEffect(() => {
    if (view) sia.setLayout(view === 'status' ? 'status' : 'onboarding')
  }, [view])

  return (
    <div ref={root}>
      <div aria-hidden className="drag-strip" />
      {view === 'sign-in' ? (
        <SignIn onDone={() => void read()} />
      ) : view === 'status' ? (
        <Details />
      ) : null}
    </div>
  )
}
