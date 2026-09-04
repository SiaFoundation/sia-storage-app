/*
 * Application lifecycle.
 *
 * The app is tray-resident. Quitting is the tray's Quit item or the platform's
 * own gesture, and nothing else.
 *
 * Electron holds no library logic, no database handle and no file bytes. It
 * attaches to the daemon, brings the OS mount up, and relays calls.
 */

import { app } from 'electron'
import { dirname, join } from 'node:path'
import { desktopConfig } from './config'
import { Daemon, type DaemonSpawn } from './daemon'
import { log } from './log'
import { createPlatformIntegration } from './platform'
import { DaemonStream } from './rpc'
import { createTray, destroyTray } from './tray'

/**
 * The daemon runtime and script sit beside the app directory the packaging
 * script writes, so the parent of `getAppPath()` is already the directory that
 * holds them. Both env vars override, which is how a checkout runs against an
 * installed build.
 */
const BUNDLED = dirname(app.getAppPath())

// A second copy would fight the first for the daemon and the tray.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const platform = createPlatformIntegration()
  const daemon = new Daemon()
  let changes: DaemonStream | null = null
  let spawn: DaemonSpawn | null = null
  let quitting: Promise<void> | null = null

  // The tray is the app's home, so an empty window list is the resting state
  // rather than a reason to exit. Present and empty on purpose: the default
  // behaviour quits on non-macOS platforms.
  app.on('window-all-closed', () => {})

  /**
   * Quitting takes the daemon with it, so the teardown has to finish before the
   * process does. `before-quit` cannot be awaited, so every pass cancels the quit
   * and the first one runs the work and exits by hand. Cancelling before the
   * guard rather than after is what stops a second gesture exiting mid-teardown.
   */
  app.on('before-quit', (event) => {
    event.preventDefault()
    if (quitting) return
    quitting = teardown()
      .catch((e) => log.error(`shutdown: ${(e as Error).message}`))
      .finally(() => app.exit(0))
  })

  async function teardown(): Promise<void> {
    changes?.stop()
    destroyTray()
    // The mount goes first. Stopping the daemon while the domain is still up
    // would leave Finder holding a live folder over nothing.
    await platform.stop()
    await daemon.stop()
  }

  /**
   * Brings the daemon back if it dies while the app is up.
   *
   * The app owns the daemon's lifetime, so an app running over a dead daemon is
   * a state to leave rather than to report. Restarts are capped: a daemon that
   * cannot stay up is a fault to surface, not to retry forever.
   */
  const MAX_RESTARTS = 5
  const RESTART_WINDOW_MS = 60_000
  let restarts: number[] = []
  let reviving = false
  // The stream keeps retrying once a second whether or not anything is
  // listening, so without this the give-up below would be logged that often for
  // as long as the app stays open.
  let gaveUp = false

  async function reviveDaemon(): Promise<void> {
    // The stream retries every second, so this is called repeatedly for one
    // outage. Attaching takes seconds; without the guard each of those calls
    // would count as its own restart and trip the cap while the daemon is
    // still coming up.
    if (quitting || reviving || !spawn) return
    reviving = true
    try {
      if (await Daemon.isReachable()) return
      const now = Date.now()
      restarts = restarts.filter((at) => now - at < RESTART_WINDOW_MS)
      if (restarts.length >= MAX_RESTARTS) {
        if (!gaveUp) {
          gaveUp = true
          log.error('daemon keeps dying; leaving it stopped')
        }
        return
      }
      // Reached once the window has rolled off enough restarts to try again.
      gaveUp = false
      restarts.push(now)
      log.info('daemon is gone; starting it again')
      log.info(`daemon ${await daemon.attach(spawn)}`)
    } finally {
      reviving = false
    }
  }

  app.whenReady().then(async () => {
    // Tray-only until the user asks for a window: a dock tile with no window
    // behind it is worse than no tile.
    if (process.platform === 'darwin') app.dock?.hide()

    // Startup is the one place a failure leaves a running process with nothing
    // working and no window to report it in, so each step says what it did.
    try {
      createTray()
      log.info('tray ready')

      // The sandboxed extension can only reach a socket inside its own
      // container, so that path is what the daemon has to be told to serve.
      const config = desktopConfig()
      const { shellSocket, handoffDir } = platform.shellPaths(config)
      spawn = {
        runtime: process.env.SIA_DAEMON_RUNTIME ?? join(BUNDLED, 'bun'),
        script: process.env.SIA_DAEMON_SCRIPT ?? join(BUNDLED, 'daemon.js'),
        shellSocket,
        handoffDir,
      }
      log.info(`daemon ${await daemon.attach(spawn)}`)

      try {
        await platform.start({
          shellSocket,
          domainId: config.domainId,
          displayName: config.displayName,
        })
        log.info(`mount ${platform.status()}`)
      } catch (e) {
        // A missing shell is not fatal: the tray still works, and the mount
        // being down is something the user finds out from the status surface.
        log.error(`mount unavailable: ${(e as Error).message}`)
      }

      // Subscribed for the disconnects rather than the events: a dropped stream
      // is how this process learns the daemon died.
      changes = new DaemonStream(
        () => {},
        () => void reviveDaemon(),
      )
      changes.start()
      log.info('subscribed to the daemon')
    } catch (e) {
      log.error(`startup failed: ${(e as Error).stack ?? String(e)}`)
    }
  })
}
