import { FS_ORPHAN_FREQUENCY } from '@siastorage/core/config'
import type { OrphanScannerResult } from '@siastorage/core/services'
import { runOrphanScanner } from '@siastorage/core/services'
import { logger } from '@siastorage/logger'
import { app } from '../stores/appService'
import { fsFileUriCache } from '../stores/fs'

/**
 * fsOrphanScanner scans the file system for files that are not indexed in the database.
 * - If a file is not indexed, it is deleted from the file system.
 * Files may be orphaned if they are from a different account, previous version of app,
 * left after an error, or other edge cases.
 */
export async function runFsOrphanScanner(options?: {
  onProgress?: (removed: number, total: number) => void
}): Promise<OrphanScannerResult | undefined> {
  const lastRun = await app().settings.getFsOrphanLastRun()
  if (Date.now() - lastRun < FS_ORPHAN_FREQUENCY) {
    return
  }
  try {
    const result = await runOrphanScanner(app(), options?.onProgress)
    fsFileUriCache.invalidateAll()
    return result
  } catch (error) {
    logger.error('fsOrphanScanner', 'scan_error', { error: error as Error })
  } finally {
    await app().settings.setFsOrphanLastRun(Date.now())
  }
}
