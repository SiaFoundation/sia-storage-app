import { readState, writeState } from '@siastorage/node-adapters'
import { connectSdk, type CliApp } from '../../app'
import type { Materializing } from '../materializing'
import type { IpcHandlerMap } from './index'

/** Handlers for daemon-process-level queries (not app state). */
export function registerStatusHandlers(
  handlers: IpcHandlerMap,
  app: CliApp,
  onShutdown: () => void,
  materializing: Materializing,
): void {
  handlers.set('ping', async () => ({ ok: true }))

  handlers.set('status', async () => ({
    running: true,
    pid: process.pid,
    connected: app.service.connection.getState().isConnected,
  }))

  /**
   * Wires the SDK from a key stored since the daemon came up.
   *
   * On its own, `connectSdk` runs only at boot, and it is the only thing that hands the
   * service an SDK. A client that signs in afterwards stores the key through
   * the facade but leaves the daemon holding nothing, so it asks for this.
   */
  handlers.set('connect', async () => {
    if (app.service.connection.getState().isConnected) return { connected: true }
    const connected = await connectSdk(app)
    // The state file is what `sia status` prints, and boot is its only other
    // writer, so without this a post-sign-in daemon reads as disconnected
    // until it restarts.
    if (connected) {
      const state = readState(app.paths.statePath)
      if (state) writeState(app.paths.statePath, { ...state, connected: true })
    }
    return { connected }
  })

  /**
   * How far the OS shell has got through writing the library out. The folder
   * total comes from the library rather than the shell, which only ever reports
   * what it has already done.
   */
  handlers.set('materializing', async () => {
    const { active, done } = materializing.state()
    // A bare COUNT: getAll() scans every active file to build per-folder
    // counts, real work to repeat on a 2-second poll while listings run.
    const total = await app.service.directories.count()
    // `done` is cumulative for the pass and `total` is live, so a folder
    // deleted mid-pass could otherwise read as "3 of 2 ready".
    return { active, done: Math.min(done, total), total }
  })

  handlers.set('shutdown', async () => {
    onShutdown()
    return { ok: true }
  })
}
