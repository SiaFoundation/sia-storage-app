/*
 * Signs the daemon in to the indexer, and keeps trying while it cannot be
 * reached.
 *
 * The desktop app opens at login and starts the daemon, often before the Mac
 * has a network. The SDK's connect throws when the indexer cannot be reached,
 * at once with no network or no DNS, and after its request timeout when
 * packets go unanswered. Trying once at boot leaves the daemon signed out
 * until it restarts, with the app showing "Connecting to indexer" the whole
 * time.
 *
 * Only a thrown attempt is retried. One that returns false reached a
 * decision: there is no account on this device, or the indexer refused the
 * key, and neither changes by asking again. Signing in later sends the
 * daemon's `connect` request, which makes a fresh attempt.
 */
import { logger } from '@siastorage/logger'
import { readState, writeState } from '@siastorage/node-adapters'
import { type CliApp, connectSdk } from '../app'

/**
 * Waits between attempts, the last repeating. Short at first, because the
 * usual cause is a network that comes up seconds after login.
 */
export const SIGN_IN_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]

export type SignIn = {
  /**
   * Makes one attempt and resolves with whether the daemon is connected. A
   * call while an attempt runs waits for that one, because the SDK's auth
   * adapter holds one builder and a second connect would replace it under
   * the first. An attempt that throws schedules the next, whoever made it.
   *
   * `firstSync` is for a sign-in made after boot. It raises the first-sync
   * gate when an attempt connects, including a retry after this one threw:
   * an account with nothing in it never sets `isSyncingDown`, so without the
   * gate a client cannot tell the first sync having finished from it not
   * having run. `syncDownEventsBatch` dismisses the gate when it catches up.
   */
  attempt(opts?: { firstSync?: boolean }): Promise<boolean>
  /** Attempts now, unless one is running, waiting or has connected. */
  start(): void
  /**
   * Ends the retries. An attempt still waiting on the indexer returns
   * without attaching the SDK or starting the uploader.
   */
  stop(): void
}

export function createSignIn(
  app: CliApp,
  opts: {
    delaysMs?: number[]
    connect?: (app: CliApp, signal: AbortSignal) => Promise<boolean>
  } = {},
): SignIn {
  const delays = opts.delaysMs ?? SIGN_IN_RETRY_DELAYS_MS
  const connect = opts.connect ?? connectSdk
  let running: Promise<boolean> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopping = new AbortController()
  let failures = 0
  let firstSyncWanted = false

  const isConnected = () => app.service.connection.getState().isConnected

  function retryLater(): void {
    if (stopping.signal.aborted || timer) return
    const inMs = delays[Math.min(failures, delays.length - 1)]
    failures += 1
    logger.info('daemon', 'sign_in_retry', { inMs, failures })
    timer = setTimeout(() => {
      timer = null
      if (!stopping.signal.aborted && !isConnected()) void once()
    }, inMs)
  }

  function once(): Promise<boolean> {
    running ??= connect(app, stopping.signal)
      .then(
        (connected) => {
          if (connected) {
            logger.info('daemon', 'signed_in', { retries: failures })
            failures = 0
            if (firstSyncWanted) app.service.sync.setState({ syncGateStatus: 'pending' })
            // `sia status` prints the state file, which boot wrote before
            // this attempt finished.
            const state = readState(app.paths.statePath)
            if (state && !state.connected) {
              writeState(app.paths.statePath, { ...state, connected: true })
            }
          }
          // Connected, or decided against: either way the request is settled.
          firstSyncWanted = false
          return connected
        },
        (e) => {
          logger.warn('daemon', 'sdk_connect_failed', { error: e as Error, failures })
          retryLater()
          return false
        },
      )
      .finally(() => {
        running = null
      })
    return running
  }

  return {
    attempt(attemptOpts) {
      if (attemptOpts?.firstSync) firstSyncWanted = true
      return once()
    },
    start() {
      if (stopping.signal.aborted) stopping = new AbortController()
      if (!timer && !running && !isConnected()) void once()
    },
    stop() {
      stopping.abort()
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
