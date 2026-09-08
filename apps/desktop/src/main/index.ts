/*
 * Application lifecycle.
 *
 * The app is tray-resident. Quitting is the tray's Quit item or Cmd-Q, and
 * nothing else: closing every window is not a reason to quit, so both routes go
 * through `beginQuit` first and the window close handler stops intercepting.
 *
 * Electron holds no library logic, no database handle and no file bytes. It
 * attaches to the daemon, brings the OS mount up, and relays calls.
 */

import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { registerBridge } from './bridge'
import { desktopConfig } from './config'
import { dataDir } from './paths'
import { Daemon, type DaemonSpawn } from './daemon'
import { confirmSignOut, warnWipeBlocked, wipeLibrary } from './signout'
import { log } from './log'
import { createPlatformIntegration } from './platform'
import { DaemonStream } from './rpc'
import { createTray, destroyTray } from './tray'
import { beginQuit, broadcast, createMainWindow, showMainWindow } from './windows'

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

  // Both can arrive before `whenReady` resolves, and a BrowserWindow built then
  // throws, so each waits rather than assuming the app is already up.
  app.on('second-instance', () => void app.whenReady().then(() => showMainWindow()))

  app.on(
    'activate',
    () =>
      void app.whenReady().then(() => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
        else showMainWindow()
      }),
  )

  // The tray is the app's home, so an empty window list is the resting state.
  // Present and empty on purpose: the default behaviour would quit.
  app.on('window-all-closed', () => {})

  /**
   * Quitting stops a daemon this app started, so the teardown has to finish
   * before the process does. `before-quit` cannot be awaited, so every pass cancels the quit
   * and the first one runs the work and exits by hand. Cancelling before the
   * guard rather than after is what stops a second gesture exiting mid-teardown.
   */
  app.on('before-quit', (event) => {
    event.preventDefault()
    if (quitting) return
    beginQuit()
    quitting = teardown()
      .catch((e) => log.error('app', 'shutdown_failed', { error: e as Error }))
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
   * Whether a live daemon still holds `daemon.lock`. The daemon closes its
   * socket before it closes the database and unlinks the lock, so an
   * unreachable socket is not yet a finished shutdown. The lock file holds
   * the owner's pid, and a dead owner means a crash leftover, which must not
   * block the wipe: the wipe removes the stale file with everything else.
   */
  function daemonHoldsLock(): boolean {
    try {
      const pid = Number.parseInt(readFileSync(join(dataDir(), 'daemon.lock'), 'utf8'), 10)
      if (!Number.isInteger(pid)) return false
      // Signal 0 delivers nothing; it only reports whether the pid exists.
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /** Polls the lock out, bounded so a hung daemon fails the wipe rather than the app. */
  async function daemonLockHeld(): Promise<boolean> {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (!daemonHoldsLock()) return false
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return true
  }

  /**
   * Relaunches rather than re-initialising in place: bringing the daemon, the
   * mount and the window back up against an empty library is what startup
   * already does, and a second path for it would only ever run here. Only
   * this app starts daemons and it is already quitting, so nothing acquires
   * the lock between the check and the wipe.
   */
  async function signOut(): Promise<void> {
    if (!(await confirmSignOut())) return
    beginQuit()
    // Assigned to `quitting` like the before-quit path: `reviveDaemon` checks
    // it, and a revive already awaiting its reachability probe would otherwise
    // resume mid-teardown and respawn the daemon while the wipe runs.
    quitting = teardown().catch((e) => log.error('app', 'sign_out_failed', { error: e as Error }))
    await quitting
    // stop() leaves an attached daemon alone and can time out on an owned one,
    // and a wipe under a live daemon deletes the database it is still writing.
    if (await Daemon.isReachable()) {
      log.error('app', 'sign_out_daemon_still_up')
      await warnWipeBlocked('A Sia daemon still holds the library. Stop it, then sign out again.')
    } else if (await daemonLockHeld()) {
      log.error('app', 'sign_out_daemon_still_closing')
      await warnWipeBlocked('The daemon is still shutting down. Sign out again in a moment.')
    } else {
      try {
        wipeLibrary()
      } catch (e) {
        log.error('app', 'wipe_failed', { error: e as Error })
        await warnWipeBlocked('Clearing the local library failed. Open Logs, then sign out again.')
      }
    }
    app.relaunch()
    app.exit(0)
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
  // The stream retries once a second whether or not anything listens, so the
  // give-up below would otherwise be logged that often, forever.
  let gaveUp = false

  async function reviveDaemon(): Promise<void> {
    // Called repeatedly for one outage, and attaching takes seconds, so without
    // this guard each call would count as a restart and trip the cap.
    if (quitting || reviving || !spawn) return
    // Same ownership rule `stop` follows. Otherwise `sia daemon stop` in a
    // terminal is undone by whichever app happens to be open.
    if (!daemon.owned) return
    reviving = true
    try {
      if (await Daemon.isReachable()) {
        // Recovered by some other route, so a later episode is a new one and
        // gets its own line rather than being swallowed by this flag.
        gaveUp = false
        return
      }
      const now = Date.now()
      restarts = restarts.filter((at) => now - at < RESTART_WINDOW_MS)
      if (restarts.length >= MAX_RESTARTS) {
        if (!gaveUp) {
          gaveUp = true
          log.error('daemon', 'gave_up_restarting')
        }
        return
      }
      // Reached once the window has rolled off enough restarts to try again.
      gaveUp = false
      restarts.push(now)
      // Re-checked past the awaits above: a teardown that began while this
      // was probing reachability must not have the daemon respawned under it.
      if (quitting) return
      log.info('daemon', 'restarting')
      log.info('daemon', 'attached', { state: await daemon.attach(spawn) })
    } finally {
      reviving = false
    }
  }

  app.whenReady().then(async () => {
    // Tray-only until the user asks for a window: a dock tile with no window
    // behind it is worse than no tile.
    if (process.platform === 'darwin') app.dock?.hide()

    let trayUp = false

    // Startup is the one place a failure leaves a running process with nothing
    // working and no window to report it in, so each step says what it did.
    try {
      registerBridge(platform, () => void signOut())
      createTray()
      trayUp = true
      log.info('app', 'tray_ready')

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
      // A source build and an installed one each pick these for themselves, so
      // a mismatch here is how the extension ends up served by the wrong daemon.
      log.info('app', 'library', { path: dataDir() })
      log.info('app', 'serving_extension', { container: dirname(shellSocket) })
      const hadSocket = existsSync(shellSocket)
      const attached = await daemon.attach(spawn)
      log.info('daemon', 'attached', { state: attached })
      // A socket file is normal on relaunch, when the daemon from the last
      // launch still answers it. A socket nothing answers is left over from a
      // crash or belongs to another data directory, and the extension hangs
      // on it.
      if (hadSocket && attached === 'unreachable') {
        log.error('app', 'stale_provider_socket', { socket: shellSocket })
      }
      // Sign-out relaunches into this path. Without the check the user lands
      // at a bare menu bar and has to find the tray icon to reach sign-in.
      void Daemon.hasAccount().then((has) => {
        if (!has) showMainWindow()
      })

      try {
        await platform.start({
          shellSocket,
          domainId: config.domainId,
          displayName: config.displayName,
        })
        log.info('mount', 'state', { state: platform.status() })
      } catch (e) {
        // A missing shell is not fatal: the tray and the window still work, and
        // the status surface reads the mount state itself through `shellStatus`.
        log.error('mount', 'unavailable', { error: e as Error })
      }

      changes = new DaemonStream(
        (event) => broadcast('change', event),
        (message) => broadcast('cache', message),
        () => {
          // The window has no other way to learn the daemon went: its reads
          // keep answering from cache, and no change signal is coming.
          broadcast('change', { event: 'change', scope: 'connection' })
          void reviveDaemon()
        },
      )
      changes.start()
      log.info('app', 'subscribed')
    } catch (e) {
      const err = e as Error
      // The formatter keeps an Error to name and message, and here the stack
      // is the diagnostic: it names the startup step that threw. Flattened,
      // because the plain log format is one line per entry.
      log.error('app', 'startup_failed', {
        error: err,
        stack: (err.stack ?? '')
          .split('\n')
          .map((frame) => frame.trim())
          .join(' | '),
      })
      // The tray carries the only Quit, so failing before it exists leaves a
      // process with no window and no icon that can only be force-quit.
      if (!trayUp) app.exit(1)
    }
  })
}
