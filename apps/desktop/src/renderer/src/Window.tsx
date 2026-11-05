/*
 * What the window shows.
 *
 * Sign-in while the daemon says there is no account, then the tour and setup
 * while the library arrives for the first time, then the status view. A daemon
 * that cannot be asked is never read as having no account. The tour and setup
 * are reached only from a sign-in made in this window: an app launched with an
 * account already on it goes straight to the status view, whatever the
 * library is doing. Share links take over the window when Finder asks to
 * share files and when the status view opens them, until they are closed,
 * and the trash takes it over when the status view opens it.
 *
 * Onboarding and the status view are different widths, and the window is told
 * which it is showing before the view is measured.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Account, nextAccount } from './account'
import { sia } from './api'
import { Details } from './Details'
import { useReportedHeight } from './height'
import { Setup } from './Setup'
import { ShareView } from './ShareView'
import { TrashView } from './TrashView'
import { SignIn } from './SignIn'

/** How often the window asks again while the daemon cannot say whether there is an account. */
const ACCOUNT_RETRY_MS = 2_000

export function Window() {
  const root = useReportedHeight<HTMLDivElement>()
  const [account, setAccount] = useState<Account>('asking')
  const [settingUp, setSettingUp] = useState(false)
  // The files Finder asked to share, null to manage links with none picked,
  // and undefined when share links are not showing. `request` counts requests,
  // so a new one starts the view over even while it shows the last link made.
  const [sharing, setSharing] = useState<{ request: number; fileIds: string[] | null } | undefined>(
    undefined,
  )
  const [showingTrash, setShowingTrash] = useState(false)

  const latest = useRef(0)
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const read = useCallback(async () => {
    // Retries and change signals overlap, so only the newest read may answer.
    const ticket = ++latest.current
    clearTimeout(retry.current)
    const answer = await sia.accountState().catch(() => null)
    if (ticket !== latest.current) return
    setAccount((prev) => nextAccount(prev, answer))
    // A connection signal does not always follow a daemon that could not
    // answer. One too busy to answer in time keeps its stream open and never
    // reports a recovery, so the window keeps asking until it gets an answer.
    if (answer === null) retry.current = setTimeout(() => void read(), ACCOUNT_RETRY_MS)
  }, [])

  useEffect(() => {
    void read()
    // The daemon reports a connection change, which is what signing in causes,
    // and the main process sends one each time it connects to the daemon.
    // Other scopes arrive several times a second during a sync, and each read
    // is two daemon round trips.
    const stop = sia.onChange((event) => {
      if (event.scope === 'connection') void read()
    })
    return () => {
      stop()
      // Also retires a read still in flight, which would otherwise schedule
      // a retry after this cleanup has run.
      latest.current += 1
      clearTimeout(retry.current)
    }
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

  // Taken on mount as well as on the signal, because a request that opened
  // this window arrived before the page was listening.
  useEffect(() => {
    const take = () =>
      void sia.takeShareRequest().then((fileIds) => {
        if (fileIds) setSharing((last) => ({ request: (last?.request ?? 0) + 1, fileIds }))
      })
    take()
    return sia.onShareRequest(take)
  }, [])

  useEffect(() => {
    if (sharing === undefined) return
    return sia.onWindowClosed(() => setSharing(undefined))
  }, [sharing])

  useEffect(() => {
    if (!showingTrash) return
    return sia.onWindowClosed(() => setShowingTrash(false))
  }, [showingTrash])

  const view = settingUp
    ? 'setup'
    : account === 'asking'
      ? null
      : account === 'signed-out'
        ? 'sign-in'
        : sharing !== undefined
          ? 'share'
          : showingTrash
            ? 'trash'
            : 'status'

  // A layout effect, so the width is on its way before the resize observer
  // reports the new view's height and the window is sized once, not twice.
  useLayoutEffect(() => {
    if (view) sia.setLayout(view === 'setup' || view === 'sign-in' ? 'onboarding' : 'status')
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
      ) : view === 'share' ? (
        <ShareView
          key={sharing?.request}
          fileIds={sharing?.fileIds ?? null}
          onDone={() => setSharing(undefined)}
        />
      ) : view === 'trash' ? (
        <TrashView onDone={() => setShowingTrash(false)} />
      ) : view === 'status' ? (
        <Details
          onShowLinks={() => setSharing({ request: 0, fileIds: null })}
          onShowTrash={() => setShowingTrash(true)}
        />
      ) : null}
    </div>
  )
}
