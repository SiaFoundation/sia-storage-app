import { logger } from '@siastorage/logger'
import { writeState } from '@siastorage/node-adapters'
import { connectSdk, createCliAppService } from '../app'
import { startIpcDispatcher } from './ipc'
import {
  acquireLockOrExit,
  attachSignalHandlers,
  executeShutdown,
  type ShutdownContext,
} from './lifecycle'
import { initializeScheduler } from './scheduler'

export type DaemonContext = ShutdownContext & {
  connected: boolean
  shutdown: () => Promise<void>
}

/**
 * Boots the daemon end-to-end: app service, single-instance lock, SDK
 * connection, scheduled background services, IPC server, signal handlers.
 * Shared by both `sia daemon start` and `sia serve`; the latter wraps the
 * returned context with an HTTP server.
 */
export async function startServices(dataDir?: string): Promise<DaemonContext> {
  const app = await createCliAppService(dataDir)
  const lock = acquireLockOrExit(app.paths)

  let connected = false
  try {
    connected = await connectSdk(app)
  } catch (e) {
    logger.warn('daemon', 'sdk_connect_failed', { error: e as Error })
  }

  const { scheduler } = initializeScheduler(app)

  writeState(app.paths.statePath, {
    pid: process.pid,
    startedAt: Date.now(),
    connected,
  })

  // The IPC server's `shutdown` handler needs to call back into the shutdown
  // function — but the function references the IPC server itself. Resolve by
  // declaring `ctx` first and assigning after both are constructed.
  let ctx: ShutdownContext
  const shutdown = () => executeShutdown(ctx)
  const ipcServer = startIpcDispatcher(app, app.paths.sockPath, () => {
    void shutdown()
  })
  ctx = { app, scheduler, ipcServer, lock }

  attachSignalHandlers(shutdown)

  return { ...ctx, connected, shutdown }
}

export async function startDaemon(dataDir?: string): Promise<void> {
  const ctx = await startServices(dataDir)
  logger.info('daemon', 'started', { pid: process.pid, connected: ctx.connected })
  console.log(`Daemon started (PID: ${process.pid})`)
}
