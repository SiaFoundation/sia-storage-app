import { FS_EVICTION_FREQUENCY } from '@siastorage/core/config'
import { SingleInit } from '@siastorage/core/lib/singleflight'
import type { CacheEvictionConfig, CacheEvictionResult } from '@siastorage/core/services'
import { EVICT_ALL_BACKED_UP, runCacheEviction } from '@siastorage/core/services'
import { logger } from '@siastorage/logger'
import { app } from '../stores/appService'
import { isBgTaskActive } from './bgTaskContext'

const flight = new SingleInit()
let activeController: AbortController | null = null
let activeRun: Promise<CacheEvictionResult | undefined> | null = null

/** Aborts an in-flight eviction run. No-op if nothing is running. */
export function cancelFsEvictionScanner(): void {
  activeController?.abort()
}

/**
 * Runs cache eviction on a schedule, behind two gates that belong to the app
 * rather than to eviction itself: iOS's background CPU budget, and a minimum
 * interval between runs. `force` bypasses both.
 *
 * `config` replaces the cap and age thresholds the passes use; see
 * [runCacheEviction] for what each pass evicts. Files not yet uploaded are
 * never evicted.
 */
export async function runFsEvictionScanner(
  opts: { force?: boolean; signal?: AbortSignal; config?: CacheEvictionConfig } = {},
): Promise<CacheEvictionResult | undefined> {
  // An abort that has already fired will not call a listener added after it,
  // so without this an aborted caller still gets a full scan.
  if (opts.signal?.aborted) return
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
  const run = flight.run(async () => {
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
  activeRun = run
  try {
    return await run
  } finally {
    if (activeRun === run) activeRun = null
  }
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
export async function clearBackedUpFsFiles(
  opts: { signal?: AbortSignal } = {},
): Promise<CacheEvictionResult | undefined> {
  // Checked before the cancel below, which would otherwise kill a running
  // scan on behalf of a caller that has already given up.
  if (opts.signal?.aborted) return
  // Runs coalesce on one key, so a scan already in flight would hand this
  // caller its own result and the config below would never take effect.
  // Cancelling it costs nothing: a clear evicts everything that run would.
  cancelFsEvictionScanner()
  await activeRun
  return runFsEvictionScanner({ force: true, config: EVICT_ALL_BACKED_UP, signal: opts.signal })
}
