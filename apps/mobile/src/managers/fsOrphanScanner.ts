import { FS_ORPHAN_FREQUENCY } from '@siastorage/core/config'
import { SingleInit } from '@siastorage/core/lib/singleflight'
import type { OrphanScannerResult } from '@siastorage/core/services'
import { runOrphanScanner } from '@siastorage/core/services'
import { logger } from '@siastorage/logger'
import { app } from '../stores/appService'
import { fsFileUriCache } from '../stores/fs'

const flight = new SingleInit()
let activeController: AbortController | null = null

/** Aborts an in-flight orphan scan. No-op if nothing is running. */
export function cancelFsOrphanScanner(): void {
  activeController?.abort()
}

/**
 * fsOrphanScanner scans the file system for files that are not indexed in the database.
 * - If a file is not indexed, it is deleted from the file system.
 * Files may be orphaned if they are from a different account, previous version of app,
 * left after an error, or other edge cases.
 */
export async function runFsOrphanScanner(options?: {
  onProgress?: (removed: number, total: number) => void
  force?: boolean
  signal?: AbortSignal
}): Promise<OrphanScannerResult | undefined> {
  if (!options?.force) {
    const lastRun = await app().settings.getFsOrphanLastRun()
    if (Date.now() - lastRun < FS_ORPHAN_FREQUENCY) {
      logger.debug('fsOrphanScanner', 'skipped', { reason: 'too_recent' })
      return
    }
  }
  return flight.run(async () => {
    activeController = new AbortController()
    const onExternalAbort = () => activeController?.abort()
    options?.signal?.addEventListener('abort', onExternalAbort)
    try {
      const result = await runOrphanScanner(app(), options?.onProgress, activeController.signal)
      fsFileUriCache.invalidateAll()
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
}
