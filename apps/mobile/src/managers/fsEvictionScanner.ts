import { FS_EVICTION_FREQUENCY } from '@siastorage/core/config'
import { SingleInit } from '@siastorage/core/lib/singleflight'
import type { CacheEvictionResult } from '@siastorage/core/services'
import { runCacheEviction } from '@siastorage/core/services'
import { logger } from '@siastorage/logger'
import { app } from '../stores/appService'

const flight = new SingleInit()

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
  return flight.run(async () => {
    try {
      const result = await runCacheEviction(app())
      await app().settings.setFsEvictionLastRun(Date.now())
      return result
    } catch (error) {
      logger.error('fsEvictionScanner', 'scan_error', { error: error as Error })
      return undefined
    }
  })
}
