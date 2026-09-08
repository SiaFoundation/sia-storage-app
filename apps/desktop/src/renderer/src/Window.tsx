/*
 * What the window shows.
 *
 * Sign-in until there is an account, a placeholder after. The library belongs
 * here and is not built yet.
 */

import { useApp } from '@siastorage/core/app'
import { useCallback, useEffect, useState } from 'react'
import { sia } from './api'
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
    return sia.onChange(() => void read())
  }, [read])

  return (
    <div ref={root}>
      {needsAccount === null ? null : needsAccount ? (
        // Sign-in is all this window does, so it hides once done. Hiding keeps
        // it mounted, so the re-read is what stops it reopening on the form.
        <SignIn
          onDone={() => {
            void read()
            void sia.closeWindow()
          }}
        />
      ) : (
        <p className="m-0 p-6 text-center text-secondary">Sia Storage</p>
      )}
    </div>
  )
}
