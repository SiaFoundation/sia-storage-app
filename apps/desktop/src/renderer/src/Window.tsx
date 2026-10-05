/*
 * What the window shows.
 *
 * Sign-in until there is an account, then the tour and setup while the library
 * arrives for the first time, then the status view. The tour and setup are
 * reached only from a sign-in made in this window: an app launched with an
 * account already on it goes straight to the status view, whatever the
 * library is doing.
 *
 * Onboarding and the status view are different widths, and the window is told
 * which it is showing before the view is measured.
 */

import { useApp } from '@siastorage/core/app'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { sia } from './api'
import { Details } from './Details'
import { useReportedHeight } from './height'
import { Setup } from './Setup'
import { SignIn } from './SignIn'

export function Window() {
  const app = useApp()
  const root = useReportedHeight<HTMLDivElement>()
  const [needsAccount, setNeedsAccount] = useState<boolean | null>(null)
  const [settingUp, setSettingUp] = useState(false)

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

  // Closing the window hides it and leaves this mounted, so without this the
  // next open would land back on an onboarding screen that may be days old.
  // The main process says when it has closed. The page's own visibility is no
  // use for that: it also reads hidden while another window covers this one,
  // and switching to a browser mid-tour would then end the tour.
  useEffect(() => {
    if (!settingUp) return
    return sia.onWindowClosed(() => setSettingUp(false))
  }, [settingUp])

  const view = settingUp
    ? 'setup'
    : needsAccount === null
      ? null
      : needsAccount
        ? 'sign-in'
        : 'status'

  // A layout effect, so the width is on its way before the resize observer
  // reports the new view's height and the window is sized once, not twice.
  useLayoutEffect(() => {
    if (view) sia.setLayout(view === 'status' ? 'status' : 'onboarding')
  }, [view])

  return (
    <div ref={root}>
      <div aria-hidden className="drag-strip" />
      {view === 'setup' ? (
        <Setup onDone={() => setSettingUp(false)} />
      ) : view === 'sign-in' ? (
        <SignIn
          onDone={() => {
            setSettingUp(true)
            void read()
          }}
        />
      ) : view === 'status' ? (
        <Details />
      ) : null}
    </div>
  )
}
