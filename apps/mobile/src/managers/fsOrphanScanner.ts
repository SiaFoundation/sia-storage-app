import {
  FS_ORPHAN_FOREGROUND_DELAY,
  FS_ORPHAN_FREQUENCY,
  FS_ORPHAN_MIN_AGE,
} from '@siastorage/core/config'
import { SingleInit } from '@siastorage/core/lib/singleflight'
import type { OrphanScannerResult } from '@siastorage/core/services'
import { runOrphanScanner } from '@siastorage/core/services'
import { logger } from '@siastorage/logger'
import { app } from '../stores/appService'
import { isBgTaskActive } from './bgTaskContext'
import { getLifecycle } from './lifecycle'

const flight = new SingleInit()
let activeController: AbortController | null = null
let activeRun: Promise<OrphanScannerResult | undefined> | null = null
let scheduled: ReturnType<typeof setTimeout> | null = null
// Bumped by every stop. A call that began before a stop can still be reading
// its last run, before it has a scan for the stop to see, so it checks this
// once that read returns.
let stops = 0

/** Aborts an in-flight orphan scan and drops a scheduled one. */
export function cancelFsOrphanScanner(): void {
  if (scheduled) clearTimeout(scheduled)
  scheduled = null
  activeController?.abort()
}

/**
 * Cancels like [cancelFsOrphanScanner] and resolves once a running scan has
 * stopped. The scan runs outside the service intervals, so stopping those
 * does not wait for it.
 */
export async function stopFsOrphanScanner(): Promise<void> {
  stops++
  cancelFsOrphanScanner()
  await activeRun
}

/**
 * Starts the daily scan once the app has been in the foreground for
 * `FS_ORPHAN_FOREGROUND_DELAY`, which keeps it out of a launch, when sync,
 * imports and the library screen all query the database at once. Each call
 * restarts the timer, because an Android app switch neither suspends the app
 * nor cancels it, and the delay counts from the latest return. The app
 * resumes for background tasks too, so the timer checks it is still in the
 * foreground when it fires.
 */
export function scheduleFsOrphanScanner(): void {
  if (scheduled) clearTimeout(scheduled)
  scheduled = setTimeout(() => {
    scheduled = null
    if (getLifecycle() !== 'foreground') return
    void runFsOrphanScanner()
  }, FS_ORPHAN_FOREGROUND_DELAY)
}

/**
 * fsOrphanScanner scans the file system for files that are not indexed in the database.
 * - If a file is not indexed, it is deleted from the file system.
 * Files may be orphaned if they are from a different account, previous version of app,
 * left after an error, or other edge cases.
 *
 * Without `force` it runs at most once a day and spares files whose fs row
 * was added in the last `FS_ORPHAN_MIN_AGE`, since it runs beside services
 * that write files. A scan cut off by an abort leaves the daily gate where it
 * was, so the next call scans again.
 */
export async function runFsOrphanScanner(options?: {
  onProgress?: (removed: number, total: number) => void
  force?: boolean
  signal?: AbortSignal
}): Promise<OrphanScannerResult | undefined> {
  const stopsAtStart = stops
  // BGAppRefreshTask still enforces iOS's 80%/60s CPU monitor; an fs
  // walk can trip cpu_resource_fatal. `force` (foreground / processing
  // task) bypasses the gate. See bgTaskContext.ts.
  if (!options?.force && isBgTaskActive('BGAppRefreshTask')) {
    logger.debug('fsOrphanScanner', 'skipped', { reason: 'bg_app_refresh_no_cpu_budget' })
    return
  }
  if (!options?.force) {
    const lastRun = await app().settings.getFsOrphanLastRun()
    if (Date.now() - lastRun < FS_ORPHAN_FREQUENCY) {
      logger.debug('fsOrphanScanner', 'skipped', { reason: 'too_recent' })
      return
    }
  }
  // Calls coalesce on one key, so a forced call would otherwise get the result
  // of a scheduled scan, which spares recently written files. Stopping that
  // scan loses nothing, since the forced one checks every file it would.
  if (options?.force && activeRun) {
    activeController?.abort()
    await activeRun
  }
  if (stops !== stopsAtStart) return
  const run = flight.run(async () => {
    activeController = new AbortController()
    const onExternalAbort = () => activeController?.abort()
    options?.signal?.addEventListener('abort', onExternalAbort)
    try {
      const result = await runOrphanScanner(
        app(),
        options?.onProgress,
        activeController.signal,
        options?.force ? undefined : { spareWrittenWithin: FS_ORPHAN_MIN_AGE },
      )
      app().caches.fsFileUri.invalidateAll()
      // Don't advance lastRun on abort — the scan didn't complete, so the
      // throttle gate should let the next attempt through instead of skipping it.
      if (activeController.signal.aborted) {
        logger.debug('fsOrphanScanner', 'aborted', { lastRunAdvanced: false })
      } else {
        await app().settings.setFsOrphanLastRun(Date.now())
      }
      return result
    } catch (error) {
      logger.error('fsOrphanScanner', 'scan_error', { error: error as Error })
      return undefined
    } finally {
      options?.signal?.removeEventListener('abort', onExternalAbort)
      activeController = null
    }
  })
  activeRun = run
  void run.finally(() => {
    if (activeRun === run) activeRun = null
  })
  return run
}
