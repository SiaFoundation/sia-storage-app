import { FS_EVICTION_FREQUENCY } from '@siastorage/core/config'
import { SingleInit } from '@siastorage/core/lib/singleflight'
import type { CacheEvictionConfig, CacheEvictionResult } from '@siastorage/core/services'
import { EVICT_ALL_BACKED_UP, runCacheEviction } from '@siastorage/core/services'
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
 *
 * The last two come from the default config, which `config` replaces. `force`
 * only bypasses the scheduling gates, so a caller wanting the cap and age
 * thresholds gone needs both; see [clearBackedUpFsFiles].
 */
export async function runFsEvictionScanner(
  opts: { force?: boolean; signal?: AbortSignal; config?: CacheEvictionConfig } = {},
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
      const result = await runCacheEviction(app(), opts.config, activeController.signal)
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

/**
 * Removes every local copy whose bytes are safely on the network.
 *
 * The scheduled scan exists to hold the cache under a cap and spares anything
 * recently used, so on a device below that cap it deletes almost nothing. A
 * user asking to clear local files wants neither gate. Files not yet uploaded
 * are still kept: that guard is in the eviction queries, not in the thresholds
 * dropped here.
 */
export function clearBackedUpFsFiles(
  opts: { signal?: AbortSignal } = {},
): Promise<CacheEvictionResult | undefined> {
  return runFsEvictionScanner({ force: true, config: EVICT_ALL_BACKED_UP, signal: opts.signal })
}
