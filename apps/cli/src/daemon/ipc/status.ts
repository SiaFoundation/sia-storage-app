import type { CliApp } from '../../app'
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

  handlers.set('shutdown', async () => {
    onShutdown()
    return { ok: true }
  })
}
