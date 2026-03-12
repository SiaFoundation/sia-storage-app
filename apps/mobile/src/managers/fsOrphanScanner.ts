import { FS_ORPHAN_FREQUENCY } from '@siastorage/core/config'
import type { OrphanScannerResult } from '@siastorage/core/services'
import * as services from '@siastorage/core/services'
import { logger } from '@siastorage/logger'
import RNFS from 'react-native-fs'
import { db } from '../db'
import {
  getAsyncStorageNumber,
  setAsyncStorageNumber,
} from '../stores/asyncStore'
import {
  deleteFsFileMetadataBatch,
  fsFileUriCache,
  listFilesInFsStorageDirectory,
} from '../stores/fs'

export async function findOrphanedFileIds(
  fileIds: string[],
): Promise<Set<string>> {
  return services.findOrphanedFileIds(db(), fileIds)
}

/**
 * fsOrphanScanner scans the file system for files that are not indexed in the database.
 * - If a file is not indexed, it is deleted from the file system.
 * Files may be orphaned if they are from a different account, previous version of app,
 * left after an error, or other edge cases.
 */
export async function runFsOrphanScanner(options?: {
  onProgress?: (removed: number, total: number) => void
}): Promise<OrphanScannerResult | undefined> {
  const lastRun = await getFsOrphanLastRun()
  if (Date.now() - lastRun < FS_ORPHAN_FREQUENCY) {
    return
  }
  try {
    return await services.runOrphanScanner({
      db: db(),
      listFiles: () => listFilesInFsStorageDirectory(),
      deleteFile: (file) => RNFS.unlink(file.uri),
      deleteFsMetadataBatch: (fileIds) => deleteFsFileMetadataBatch(fileIds),
      invalidateCache: async () => void fsFileUriCache.invalidateAll(),
      onProgress: options?.onProgress,
    })
  } catch (error) {
    logger.error('fsOrphanScanner', 'scan_error', { error: error as Error })
  } finally {
    await setFsOrphanLastRun()
  }
}

export async function setFsOrphanLastRun(): Promise<void> {
  await setAsyncStorageNumber('fsOrphanLastRun', Date.now())
}

export async function getFsOrphanLastRun(): Promise<number> {
  return await getAsyncStorageNumber('fsOrphanLastRun', 0)
}
