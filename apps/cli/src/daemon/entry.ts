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
 * Booted by `sia daemon start`, detached by default or in the terminal with
 * `--foreground`.
 */
export async function startServices(dataDir?: string): Promise<DaemonContext> {
  // Spawned detached, stdout is the daemon.log file, and escape codes would
  // garble it, so colour only when stdout is a real terminal (`--foreground`).
  addAppender(createConsoleAppender({ ansi: process.stdout.isTTY === true }))

  // Env rather than flags: `spawnDaemon` re-spawns this with no argv, so the
  // environment is the only channel that survives. Absent means no shell.
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

  // Declared before either is built because the IPC server's `shutdown` calls
  // the function that references it. Signal handlers attach after it is set.
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
    ? startProviderListener(
        app,
        surface.handlers,
        {
          socketPath: providerSocket,
          version: DAEMON_VERSION,
          libraryPath: app.paths.dataDir,
        },
        surface.materializing,
      )
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
