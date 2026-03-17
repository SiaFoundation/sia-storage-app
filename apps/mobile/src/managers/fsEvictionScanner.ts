import { FS_EVICTION_FREQUENCY } from '@siastorage/core/config'
import type { CacheEvictionResult } from '@siastorage/core/services'
import { runCacheEviction } from '@siastorage/core/services'
import { logger } from '@siastorage/logger'
import { app } from '../stores/appService'

/**
 * fsEvictionScanner evicts stale files from the file system under the following rules:
 * - Local-only files are always retained no matter how much space they take up.
 * - Only start eviction if we are above the FS_MAX_BYTES limit.
 * - Only evict a specific file if it is older than FS_EVICTABLE_MIN_AGE.
 */
export async function runFsEvictionScanner(): Promise<
  CacheEvictionResult | undefined
> {
  const lastRun = await app().settings.getFsEvictionLastRun()
  if (Date.now() - lastRun < FS_EVICTION_FREQUENCY) {
    return
  }
  try {
    return await runCacheEviction(app())
  } catch (error) {
    logger.error('fsEvictionScanner', 'scan_error', { error: error as Error })
  } finally {
    await app().settings.setFsEvictionLastRun(Date.now())
  }
}
