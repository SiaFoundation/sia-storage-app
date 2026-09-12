import { readState, writeState } from '@siastorage/node-adapters'
import { connectSdk, type CliApp } from '../../app'
import type { IpcHandlerMap } from './index'

/** Handlers for daemon-process-level queries (not app state). */
export function registerStatusHandlers(
  handlers: IpcHandlerMap,
  app: CliApp,
  onShutdown: () => void,
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

  handlers.set('shutdown', async () => {
    onShutdown()
    return { ok: true }
  })
}
