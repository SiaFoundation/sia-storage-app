import { FS_EVICTION_FREQUENCY } from '@siastorage/core/config'
import { SingleInit } from '@siastorage/core/lib/singleflight'
import type { CacheEvictionResult } from '@siastorage/core/services'
import { runCacheEviction } from '@siastorage/core/services'
import { logger } from '@siastorage/logger'
import { app } from '../stores/appService'
import { isBgTaskActive } from './bgTaskContext'

const flight = new SingleInit()
let activeController: AbortController | null = null

/** Aborts an in-flight eviction run. No-op if nothing is running. */
export function cancelFsEvictionScanner(): void {
  activeController?.abort()
}

/**
 * fsEvictionScanner evicts stale files from the file system under the following rules:
 * - Local-only files are always retained no matter how much space they take up.
 * - Only start eviction if we are above the FS_MAX_BYTES limit.
 * - Only evict a specific file if it is older than FS_EVICTABLE_MIN_AGE.
 */
export async function runFsEvictionScanner(
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<CacheEvictionResult | undefined> {
  // BGAppRefreshTask still enforces iOS's 80%/60s CPU monitor; an
  // eviction scan can trip cpu_resource_fatal. `force` (foreground /
  // processing task) bypasses the gate. See bgTaskContext.ts.
  if (!opts.force && isBgTaskActive('BGAppRefreshTask')) {
    logger.debug('fsEvictionScanner', 'skipped', { reason: 'bg_app_refresh_no_cpu_budget' })
    return
  }
  if (!opts.force) {
    const lastRun = await app().settings.getFsEvictionLastRun()
    if (Date.now() - lastRun < FS_EVICTION_FREQUENCY) {
      logger.debug('fsEvictionScanner', 'skipped', { reason: 'too_recent' })
      return
    }
  }
  return flight.run(async () => {
    activeController = new AbortController()
    const onExternalAbort = () => activeController?.abort()
    opts.signal?.addEventListener('abort', onExternalAbort)
    try {
      const result = await runCacheEviction(app(), undefined, activeController.signal)
      // Don't advance lastRun on abort — the scan didn't complete, so the
      // throttle gate should let the next attempt through instead of skipping it.
      if (activeController.signal.aborted) {
        logger.debug('fsEvictionScanner', 'aborted', { lastRunAdvanced: false })
      } else {
        await app().settings.setFsEvictionLastRun(Date.now())
      }
      return result
    } catch (error) {
      logger.error('fsEvictionScanner', 'scan_error', { error: error as Error })
      return undefined
    } finally {
      opts.signal?.removeEventListener('abort', onExternalAbort)
      activeController = null
    }
  })
}
