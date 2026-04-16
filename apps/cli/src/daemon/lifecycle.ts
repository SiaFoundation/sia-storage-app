import type { ServiceScheduler } from '@siastorage/core/lib/serviceInterval'
import { logger } from '@siastorage/logger'
import { acquireLock, removeState, type LockHandle } from '@siastorage/node-adapters'
import type { CliApp } from '../app'

export type ShutdownContext = {
  app: CliApp
  scheduler: ServiceScheduler
  ipcServer: { close(): void }
  lock: LockHandle
}

/**
 * Acquires the single-instance daemon lock, or exits the process with a clear
 * error if another daemon is already running.
 */
export function acquireLockOrExit(paths: CliApp['paths']): LockHandle {
  const lock = acquireLock(paths.lockPath, paths.pidPath)
  if (!lock) {
    console.error('Daemon already running (or lock file is stale)')
    process.exit(1)
  }
  return lock
}

export function attachSignalHandlers(shutdown: () => Promise<void>): void {
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/**
 * Runs the graceful shutdown sequence: drain uploader, stop services, close
 * IPC, finalize and close the database, remove state file, release lock.
 */
export async function executeShutdown(ctx: ShutdownContext): Promise<void> {
  logger.info('daemon', 'shutting_down')
  await ctx.app.service.uploader.shutdown()
  await ctx.scheduler.shutdown()
  ctx.ipcServer.close()
  await ctx.app.db.finalize?.()
  ctx.app.db.close?.()
  removeState(ctx.app.paths.statePath)
  ctx.lock.release()
  process.exit(0)
}
