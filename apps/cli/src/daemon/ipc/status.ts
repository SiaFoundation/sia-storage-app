import type { CliApp } from '../../app'
import { cliVersion, daemonBuild } from '../../lib/version'
import type { Materializing } from '../materializing'
import { createSignIn, type SignIn } from '../signIn'
import type { IpcHandlerMap } from './index'

/**
 * Set by the desktop app in the environment it spawns the daemon with. Local
 * desktop packaging links this same script as a `sia` command, so the build
 * alone cannot tell the app's daemon from one a person started in a terminal.
 */
export function daemonStarter(): 'desktop' | 'cli' {
  return process.env.SIA_DAEMON_STARTED_BY === 'desktop' ? 'desktop' : 'cli'
}

/** Handlers for daemon-process-level queries (not app state). */
export function registerStatusHandlers(
  handlers: IpcHandlerMap,
  app: CliApp,
  onShutdown: () => void,
  materializing: Materializing,
  signIn: SignIn = createSignIn(app),
): void {
  handlers.set('ping', async () => ({ ok: true }))

  /**
   * Which build is serving and what started it. The desktop app asks on
   * launch: a daemon started by an earlier install is replaced, and one
   * started from a terminal is not stopped without asking.
   */
  handlers.set('version', async () => ({
    build: daemonBuild(),
    version: cliVersion(),
    pid: process.pid,
    startedBy: daemonStarter(),
  }))

  handlers.set('status', async () => ({
    running: true,
    pid: process.pid,
    connected: app.service.connection.getState().isConnected,
  }))

  /**
   * Wires the SDK from a key stored since the daemon came up.
   *
   * The daemon's own sign-in stops once an attempt finds no account. A client
   * that signs in afterwards stores the key through the facade but leaves the
   * daemon holding nothing, so it asks for this.
   */
  handlers.set('connect', async () => {
    if (app.service.connection.getState().isConnected) return { connected: true }
    const connected = await signIn.attempt({ firstSync: true })
    return { connected }
  })

  /**
   * How far the OS shell has got through writing the library out. The folder
   * total comes from the library rather than the shell, which only ever reports
   * what it has already done.
   */
  handlers.set('materializing', async () => {
    const { active, done, passes } = materializing.state()
    // A bare COUNT: getAll() scans every active file to build per-folder
    // counts, real work to repeat on a 2-second poll while listings run.
    const total = await app.service.directories.count()
    // `done` counts folders the system read during the pass and `total` is
    // live, so a folder deleted mid-pass could otherwise read as "3 of 2".
    return { active, done: Math.min(done, total), total, passes }
  })

  handlers.set('shutdown', async () => {
    onShutdown()
    return { ok: true }
  })
}
