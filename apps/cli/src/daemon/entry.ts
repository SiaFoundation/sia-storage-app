import { addAppender, createConsoleAppender, logger } from '@siastorage/logger'
import packageJson from '../../package.json'
import { writeState } from '@siastorage/node-adapters'
import { connectSdk, createCliAppService } from '../app'
import { buildIpcSurface, startIpcDispatcher } from './ipc'
import { startProviderListener } from './ipc/provider'
import {
  acquireLockOrExit,
  attachSignalHandlers,
  executeShutdown,
  type ShutdownContext,
} from './lifecycle'
import { initializeScheduler } from './scheduler'

/**
 * Build identifier a storage-provider shell must match to call anything.
 *
 * Read from the package because the packaging script stamps the same value into
 * the extension's Info.plist; two hand-maintained constants would only disagree
 * at run time.
 */
const DAEMON_VERSION = packageJson.version

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
  // Daemon stdio is captured to daemon.log by spawnDaemon — the console
  // appender's output flows there.
  addAppender(createConsoleAppender({ ansi: true }))

  // Env rather than flags: `spawnDaemon` re-spawns this program with no argv at
  // all, so the environment is the only channel that survives being backgrounded.
  // Absent means no shell is served and the daemon is a plain CLI daemon.
  const providerSocket = process.env.SIA_PROVIDER_SOCKET
  const handoffDir = process.env.SIA_HANDOFF_DIR

  const app = await createCliAppService(dataDir, { handoffDir })
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
  // declaring `ctx` first and assigning after both are constructed. Signal
  // handlers attach AFTER `ctx` is set so a signal can never observe it null.
  let ctx: ShutdownContext | null = null
  const shutdown = async () => {
    if (!ctx) return
    return executeShutdown(ctx)
  }
  // Cache mutations reach this socket only. A storage-provider shell holds no
  // caches, so the provider socket carries the change signal alone.
  const surface = buildIpcSurface(app, () => {
    void shutdown()
  })
  const ipcServer = startIpcDispatcher(app, app.paths.sockPath, surface)
  const providerServer = providerSocket
    ? startProviderListener(app, surface.handlers, {
        socketPath: providerSocket,
        version: DAEMON_VERSION,
      })
    : undefined
  ctx = { app, scheduler, ipcServer, providerServer, lock }

  attachSignalHandlers(shutdown)

  return { ...ctx, connected, shutdown }
}

export async function startDaemon(dataDir?: string): Promise<void> {
  const ctx = await startServices(dataDir)
  logger.info('daemon', 'started', { pid: process.pid, connected: ctx.connected })
  console.log(`Daemon started (PID: ${process.pid})`)
}
